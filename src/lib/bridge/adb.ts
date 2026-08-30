/**
 * ADB bridge abstraction.
 * - Native (on Quest via Capacitor): Runtime.exec() directly
 * - Desktop (browser + local server): proxies to `adb shell` on host
 * - Mock (browser, no server): returns fake responses for dev
 */

import { Capacitor } from '@capacitor/core'
import {
  Apps, DeviceInfo, ShellExec,
  type Elevation, type NativeApp,
} from '../plugins/shell-exec'
import type { Mode, Privilege } from './capabilities'
import type { DisplaySettings, RecordingSettings } from '../stores/device.svelte'
import { t } from '../i18n/index.svelte'

// Re-exported so every existing `import type { Mode } from '../bridge/adb'` keeps working, and so
// the two axes stay in one file with no import cycle back into the bridge.
export type { Mode, Privilege } from './capabilities'

let mode: Mode = 'mock'
let connected = true
let notifyConnectionChange: (() => void) | null = null

/**
 * What commands run as, which is not what `mode` says. These are the defaults before anything is
 * probed, and each one is already known to be right: mock discards writes, the desktop bridge
 * really does run `adb shell`, and a sideloaded app really does run as itself. Only native can be
 * promoted, and only on evidence — see probePrivilege().
 */
function defaultPrivilegeFor(m: Mode): Privilege {
  return m === 'desktop' ? 'shell' : m === 'native' ? 'app' : 'none'
}

let privilege: Privilege = 'none'

const modeReady: Promise<void> = Capacitor.isNativePlatform()
  ? (mode = 'native', privilege = 'app', Promise.resolve())
  : fetch('/api/ping', { signal: AbortSignal.timeout(800) })
      .then(r => { if (r.ok) { mode = 'desktop'; setPrivilege('shell') } })
      .catch(() => {})

export function getConnectionMode(): Mode { return mode }
export function isServerConnected(): boolean { return mode !== 'desktop' || connected }

/** What this route can run as right now. Never persisted: `adb tcpip` does not survive a reboot. */
export function getPrivilege(): Privilege { return privilege }

// --- Elevation (the privileged channel on the headset) ---

/** Off the headset there is no channel, and saying so is more honest than an invented state. */
const NO_CHANNEL: Elevation = { state: 'UNSUPPORTED', detail: 'Only the headset build can be unlocked' }

export async function getElevation(): Promise<Elevation> {
  await modeReady
  if (mode !== 'native') return NO_CHANNEL
  return ShellExec.elevationState()
}

/**
 * Asks adbd on this same headset for a shell. Returns where it got to rather than throwing, because
 * "nothing is listening", "the prompt is showing" and "nobody answered" each need their own
 * sentence. A promotion is never taken on the connection alone — the capability probe has to pass.
 */
export async function elevate(): Promise<Elevation> {
  await modeReady
  if (mode !== 'native') return NO_CHANNEL
  const result = await ShellExec.elevate()
  if (result.state === 'CONNECTED') await probePrivilege(true)
  return result
}

export async function endElevation(): Promise<Elevation> {
  await modeReady
  if (mode !== 'native') return NO_CHANNEL
  const result = await ShellExec.disconnect()
  await probePrivilege(true)
  return result
}

// A dropped connection is the dangerous state: every gated control has to go back to disabled the
// moment it happens, not the next time a command fails.
if (Capacitor.isNativePlatform()) {
  void ShellExec.addListener('elevationChange', payload => {
    if (payload.state === 'CONNECTED') void probePrivilege(true)
    else if (privilege === 'shell') { invalidatePrivilege(); setPrivilege('app') }
  })
}

/**
 * True while every read is answered from the fixture table below instead of a headset.
 *
 * A view MUST NOT present a value read while this is true as device truth: no model, battery
 * level, SSID, storage figure, firmware string, display prop or package list. Render it as
 * "no headset attached" (or label it demo data) and offer a reconnect, the same way writes are
 * already labelled demo. `isDeviceInfoFixture()` in the device store carries this for the
 * headset card; call this directly for a read the store does not own, such as the app list.
 */
export function isFixtureRead(): boolean { return mode === 'mock' }

/** Called whenever the bridge drops or comes back, so the store can update without a manual refresh. */
export function setConnectionListener(fn: () => void): void {
  notifyConnectionChange = fn
}

function setConnected(next: boolean): void {
  if (connected === next) return
  connected = next
  notifyConnectionChange?.()
}

// Mirrors setConnected: the notify is the whole reactivity story, so every gated control in the
// app disables or re-enables itself without any view knowing a probe happened.
function setPrivilege(next: Privilege): void {
  if (privilege === next) return
  privilege = next
  notifyConnectionChange?.()
}

/** Scratch key the probe writes. Filtered out of getCurrentOculusProps() so it reaches no backup or tally. */
const PROBE_PROP_PREFIX = 'debug.oculus.tomProbe'

let probed = false
let probeInFlight: Promise<Privilege> | null = null

/** Forget the probe result, so the next probePrivilege() asks the headset again. */
export function invalidatePrivilege(): void {
  probed = false
}

/**
 * Asks the headset whether this route may write a render prop, by writing one and reading it back.
 *
 * /system/etc/selinux/plat_property_contexts maps `debug.` as a single prefix rule with no more
 * specific `debug.oculus.` rule, so a scratch `debug.oculus.<nonce>` exercises exactly the same
 * permission as debug.oculus.cpuLevel. Android 10+ does allow `exact` per-property entries, so if a
 * build ever declares the render props individually the scratch key falls back to the broader rule
 * and the probe can read as a false positive — never a false negative. A failing probe therefore
 * gates hard, and a passing one is confirmed by the first real write via the guard in setprop().
 */
export async function probePrivilege(force = false): Promise<Privilege> {
  if (force) invalidatePrivilege()
  probeInFlight ??= runProbe().finally(() => { probeInFlight = null })
  return probeInFlight
}

async function runProbe(): Promise<Privilege> {
  await modeReady
  // Only native is in doubt. Mock discards everything and the bridge runs as the adb shell user.
  if (mode !== 'native') {
    probed = true
    setPrivilege(mode === 'desktop' && !connected ? 'none' : defaultPrivilegeFor(mode))
    return privilege
  }
  if (probed) return privilege

  const key = `${PROBE_PROP_PREFIX}.${Math.random().toString(36).slice(2, 8)}`
  const nonce = Date.now().toString(36)
  let mayWrite = false
  try {
    // setprop already reads back and throws on mismatch, so a refusal that still exits 0 is caught.
    await setprop(key, nonce)
    mayWrite = true
    await setprop(key, '')
  } catch {
    // Refused, or written and unreadable. Either way it is not a working write.
  }
  probed = true
  setPrivilege(mayWrite ? 'shell' : 'app')
  return privilege
}

export async function reconnect(): Promise<void> {
  if (Capacitor.isNativePlatform()) return
  try {
    const res = await fetch('/api/ping', { signal: AbortSignal.timeout(800) })
    if (res.ok) { mode = 'desktop'; setConnected(true); setPrivilege('shell') }
    else { mode = 'mock'; setConnected(false); setPrivilege('none') }
  } catch {
    mode = 'mock'
    setConnected(false)
    setPrivilege('none')
  }
}

// Fixtures, not a headset. Anything answered from here is flagged by isFixtureRead().
const mockResponses: Record<string, string> = {
  'getprop ro.product.model': 'Quest 3',
  'getprop ro.build.display.id': 'SQ3A.220705.003',
  'dumpsys battery': '  level: 78\n  status: 3\n  health: 2\n  plugged: 0',
  'df /storage/emulated/0': 'Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/fuse      117220352 89767936  27452416  77% /storage/emulated',
  'dumpsys wifi': '  mWifiInfo SSID: "HomeNetwork", RSSI: -45',
  'ip addr show wlan0': 'inet 192.168.1.100/24 brd 192.168.1.255 scope global wlan0',
  'pm list packages -3': 'package:com.oculus.filemanager\npackage:com.sidequest.wrapper\npackage:org.fdroid.fdroid\npackage:com.oculus.ovrmonitormetricsservice\npackage:com.beatgames.beatsaber\npackage:com.Resolution.GorillTag',
  'getprop debug.oculus.textureWidth': '1832',
  'getprop debug.oculus.textureHeight': '1920',
  'getprop debug.oculus.refreshRate': '120',
  'getprop debug.oculus.cpuLevel': '3',
  'getprop debug.oculus.gpuLevel': '3',
  'getprop debug.oculus.ffrLevel': '2',
  'getprop debug.oculus.adaclocks.cpuDynamic': '1',
  'getprop debug.oculus.adaclocks.gpuDynamic': '1',
  'getprop debug.oculus.ffrDynamic': '0',
  'getprop': '[debug.oculus.textureWidth]: [1832]\n[debug.oculus.textureHeight]: [1920]\n[debug.oculus.refreshRate]: [120]\n[debug.oculus.cpuLevel]: [3]\n[debug.oculus.gpuLevel]: [3]\n[debug.oculus.ffrLevel]: [2]',
}

function getMockResponse(command: string): string {
  return mockResponses[command] ?? ''
}

interface BridgeResult {
  output?: string
  error?: string
  exitCode?: number
}

/** Posts to the dev bridge. A dead bridge is reported, never faked into a success. */
async function postBridge(path: string, body: unknown): Promise<BridgeResult> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    if (e instanceof TypeError) {
      setConnected(false)
      throw new Error(t('bridge.offline'))
    }
    throw e
  }
  // A resolved fetch is not a live bridge: the Vite proxy answers 500 when nothing is listening,
  // and res.json() on that body throws 'Unexpected end of JSON input' instead of saying so.
  if (!res.ok) {
    setConnected(false)
    throw new Error(t('bridge.refused', { status: res.status }))
  }
  setConnected(true)
  return res.json()
}

function describeFailure(command: string, r: BridgeResult): string {
  return `${command}: ${r.error || r.output || `exited ${r.exitCode}`}`.trim()
}

async function desktopShell(command: string): Promise<string> {
  const data = await postBridge('/api/shell', { command })
  if (data.exitCode !== 0) throw new Error(describeFailure(command, data))
  return data.output ?? ''
}

export async function shell(command: string): Promise<string> {
  await modeReady
  if (mode === 'native') {
    const result = await ShellExec.exec({ command })
    if (result.exitCode !== 0) throw new Error(describeFailure(command, result))
    return result.output
  }
  if (mode === 'desktop') return desktopShell(command)
  console.log(`[mock] ${command}`)
  return getMockResponse(command)
}

/**
 * A denied setprop still exits 0 on some builds, so a write is only believed once it reads back.
 * One guard here covers every prop write in the app — levels, resolution, refresh rate, capture
 * config and the erase — the same discipline as the kiosk read-back in System.
 */
export async function setprop(prop: string, value: string | number): Promise<void> {
  const wanted = String(value)
  await shell(`setprop ${prop} '${wanted}'`)
  // The mock table has no writes to read back; it already answers every getprop from fixtures.
  if (mode === 'mock') return
  const readBack = await getprop(prop)
  if (readBack === wanted) return
  // A sideloaded app runs as itself and Android refuses it these writes. Demoting here rather than
  // in each view means one guard disables every gated control at once, through the same channel a
  // dropped bridge already uses.
  if (mode === 'native') setPrivilege('app')
  throw new Error(
    `${prop} did not take: the headset still reads ${readBack ? `'${readBack}'` : 'no value'}`,
  )
}

export async function getprop(prop: string): Promise<string> {
  return (await shell(`getprop ${prop}`)).trim()
}

export async function setResolution(width: number, height: number): Promise<void> {
  await setprop('debug.oculus.textureWidth', width)
  await setprop('debug.oculus.textureHeight', height)
}

export async function setCpuLevel(level: number, dynamic: boolean): Promise<void> {
  await setprop('debug.oculus.cpuLevel', level)
  await setprop('debug.oculus.adaclocks.cpuDynamic', dynamic ? 1 : 0)
}

export async function setGpuLevel(level: number, dynamic: boolean): Promise<void> {
  await setprop('debug.oculus.gpuLevel', level)
  await setprop('debug.oculus.adaclocks.gpuDynamic', dynamic ? 1 : 0)
}

export async function setFfrLevel(level: number, dynamic: boolean): Promise<void> {
  await setprop('debug.oculus.ffrLevel', level)
  await setprop('debug.oculus.ffrDynamic', dynamic ? 1 : 0)
}

export async function setRefreshRate(hz: number): Promise<void> {
  await setprop('debug.oculus.refreshRate', hz)
}

/** Blanks every debug.oculus.* render prop. Nothing outside that namespace is touched, so kiosk props survive. */
export async function clearAllSettings(): Promise<void> {
  for (const prop of Object.keys(await getCurrentOculusProps())) {
    await setprop(prop, '')
  }
}

/**
 * On the headset this hands the file to the system installer, which asks the user to confirm — an
 * app can never install silently, so the prompt is the mechanism, not a shortfall. Over the bridge
 * it is still a real `adb install`, which is why the two return different sentences.
 */
export async function installApk(path: string): Promise<string> {
  await modeReady
  if (mode === 'native') {
    await Apps.install({ path })
    return 'Handed to the headset’s installer — confirm it there to finish'
  }
  if (mode === 'desktop') {
    const data = await postBridge('/api/install', { path })
    if (data.exitCode !== 0) throw new Error(describeFailure('install', data))
    return data.output ?? ''
  }
  return shell(`pm install -r "${path}"`)
}

export async function launchApp(packageName: string): Promise<void> {
  await modeReady
  // `monkey` is refused to an app uid; starting the launch Intent is not.
  if (mode === 'native') {
    await Apps.launch({ packageName })
    return
  }
  await shell(`monkey -p ${packageName} 1`)
}

export async function forceStop(packageName: string): Promise<void> {
  await shell(`am force-stop ${packageName}`)
}

export async function reboot(): Promise<void> {
  await shell('svc power reboot')
}

export async function getInstalledPackages(): Promise<string[]> {
  await modeReady
  if (mode === 'native') return (await Apps.list({ icons: false })).apps.map(a => a.packageName)
  const output = await shell('pm list packages -3')
  return output.split('\n').filter(Boolean).map(l => l.replace('package:', ''))
}

/**
 * The same list with the real label and icon, which only PackageManager can give — `pm list
 * packages -3` returns bare ids, which is why the picker used to guess a name from the last
 * segment. Off the headset there is nothing but the id, so label falls back to it and the caller
 * renders exactly what it has.
 */
export async function getInstalledApps(): Promise<NativeApp[]> {
  await modeReady
  if (mode === 'native') return (await Apps.list()).apps
  return (await getInstalledPackages()).map(packageName => ({
    packageName,
    label: packageName,
    versionName: '',
    enabled: true,
  }))
}

export async function startRecording(): Promise<void> {
  await setprop('debug.oculus.enableVideoCapture', 1)
}

export async function stopRecording(): Promise<void> {
  await setprop('debug.oculus.enableVideoCapture', 0)
}

// --- Device info queries ---

// --- Device info queries ---
//
// `dumpsys battery` and `dumpsys wifi` are refused outright to an app uid on a Quest 3 ("Can't find
// service"), so on a headset install every one of these read blank. The framework calls behind
// DeviceInfo need no privilege and no setup, so on the headset they are the primary path and the
// shell parsing below is only ever reached through the desktop bridge or the mock table.

/** KB in, human out — kept in KB because `df` reports 1K blocks. */
function formatKb(kb: number): string {
  return kb > 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : `${(kb / 1024).toFixed(0)} MB`
}

/**
 * One native call per refresh, not five. refreshDevice() asks for model, battery, storage, address
 * and firmware at once, and every one of them is a field of the same struct; sharing the in-flight
 * promise collapses them without caching anything across refreshes.
 */
let deviceInfoInFlight: Promise<Awaited<ReturnType<typeof DeviceInfo.info>>> | null = null

function readDeviceInfo() {
  deviceInfoInFlight ??= DeviceInfo.info().finally(() => { deviceInfoInFlight = null })
  return deviceInfoInFlight
}

export async function getBatteryInfo(): Promise<{ level: number; charging: boolean }> {
  await modeReady
  if (mode === 'native') {
    const info = await readDeviceInfo()
    return { level: info.batteryLevel, charging: info.charging }
  }
  const raw = await shell('dumpsys battery')
  const level = parseInt(raw.match(/level:\s*(\d+)/)?.[1] ?? '0')
  const status = parseInt(raw.match(/status:\s*(\d+)/)?.[1] ?? '0')
  return { level, charging: status === 2 || status === 5 }
}

export async function getStorageInfo(): Promise<{ free: string; total: string }> {
  await modeReady
  if (mode === 'native') {
    const info = await readDeviceInfo()
    return { free: formatKb(info.freeBytes / 1024), total: formatKb(info.totalBytes / 1024) }
  }
  const raw = await shell('df /storage/emulated/0')
  const parts = raw.split('\n')[1]?.trim().split(/\s+/)
  if (!parts || parts.length < 4) return { free: '?', total: '?' }
  return { free: formatKb(parseInt(parts[3])), total: formatKb(parseInt(parts[1])) }
}

export interface WifiRead {
  ssid: string
  ip: string
  signal: number
  /** True when Android withheld the network name because the location permission is not granted. */
  ssidHidden: boolean
}

export async function getWifiInfo(): Promise<WifiRead> {
  await modeReady
  if (mode === 'native') {
    // Split on purpose: the address comes back regardless, the name needs a runtime permission.
    const [info, wifi] = await Promise.all([readDeviceInfo(), DeviceInfo.wifi()])
    return { ssid: wifi.ssid, ip: info.ip, signal: wifi.signal, ssidHidden: wifi.ssidHidden }
  }
  const wifiRaw = await shell('dumpsys wifi')
  const ssid = wifiRaw.match(/SSID:\s*"?([^",]+)"?/)?.[1] ?? ''
  const signal = parseInt(wifiRaw.match(/RSSI:\s*(-?\d+)/)?.[1] ?? '0')
  // A headset with no wlan0 interface still has an SSID worth reporting, so this read fails alone.
  const ipRaw = await shell('ip addr show wlan0').catch(() => '')
  const ip = ipRaw.match(/inet\s+([\d.]+)/)?.[1] ?? ''
  return { ssid, ip, signal, ssidHidden: false }
}

export async function getFirmwareVersion(): Promise<string> {
  await modeReady
  if (mode === 'native') return (await readDeviceInfo()).firmware
  return getprop('ro.build.display.id')
}

export async function getModel(): Promise<string> {
  await modeReady
  if (mode === 'native') return (await readDeviceInfo()).model
  return getprop('ro.product.model')
}

export interface DisplayReadback {
  /** Only the props that read back with a usable value. */
  values: Partial<DisplaySettings>
  /** DisplaySettings keys whose prop is empty or holds junk — the headset is on its own default. */
  unset: (keyof DisplaySettings)[]
}

type NumericDisplayKey = 'resolutionWidth' | 'resolutionHeight' | 'refreshRate' | 'cpuLevel' | 'gpuLevel' | 'ffrLevel'
type FlagDisplayKey = 'cpuDynamic' | 'gpuDynamic' | 'ffrDynamic'

export async function getCurrentDisplaySettings(): Promise<DisplayReadback> {
  const [w, h, rr, cpu, gpu, ffr, cpuD, gpuD, ffrD] = await Promise.all([
    getprop('debug.oculus.textureWidth'),
    getprop('debug.oculus.textureHeight'),
    getprop('debug.oculus.refreshRate'),
    getprop('debug.oculus.cpuLevel'),
    getprop('debug.oculus.gpuLevel'),
    getprop('debug.oculus.ffrLevel'),
    getprop('debug.oculus.adaclocks.cpuDynamic'),
    getprop('debug.oculus.adaclocks.gpuDynamic'),
    getprop('debug.oculus.ffrDynamic'),
  ])

  const values: Partial<DisplaySettings> = {}
  const unset: (keyof DisplaySettings)[] = []

  // setprop accepts anything, so a prop can hold a value the runtime never used. Out of domain counts as unset.
  const readNumber = (key: NumericDisplayKey, raw: string, min: number, max: number) => {
    const n = parseInt(raw)
    if (raw && Number.isFinite(n) && n >= min && n <= max) values[key] = n
    else unset.push(key)
  }
  const readFlag = (key: FlagDisplayKey, raw: string) => {
    if (raw) values[key] = raw === '1'
    else unset.push(key)
  }

  readNumber('resolutionWidth', w, 512, 4096)
  readNumber('resolutionHeight', h, 512, 4096)
  readNumber('refreshRate', rr, 60, 120)
  readNumber('cpuLevel', cpu, 0, 4)
  readNumber('gpuLevel', gpu, 0, 4)
  readNumber('ffrLevel', ffr, 0, 4)
  readFlag('cpuDynamic', cpuD)
  readFlag('gpuDynamic', gpuD)
  readFlag('ffrDynamic', ffrD)

  return { values, unset }
}

// --- Recording settings ---

const eyeMap = { left: 0, right: 1, both: 2 } as const

/** The UI works in whole percent, the fovCrop props take a 0.0-1.0 fraction. */
function toCropFraction(percent: number): number {
  return Math.min(1, Math.max(0, percent / 100))
}

// Sequential on purpose: a failure stops at a known prop instead of leaving a half-written capture config.
export async function applyRecordingSettings(rec: RecordingSettings): Promise<void> {
  await setprop('debug.oculus.capture.width', rec.width)
  await setprop('debug.oculus.capture.height', rec.height)
  await setprop('debug.oculus.capture.bitrate', rec.bitrate * 1000)
  await setprop('debug.oculus.capture.fps', rec.framerate)
  await setprop('debug.oculus.screenCaptureEye', eyeMap[rec.eye])
  if (rec.fovCrop) {
    await setprop('debug.oculus.fovCrop.up', toCropFraction(rec.fovCrop.up))
    await setprop('debug.oculus.fovCrop.down', toCropFraction(rec.fovCrop.down))
    await setprop('debug.oculus.fovCrop.inward', toCropFraction(rec.fovCrop.inward))
    await setprop('debug.oculus.fovCrop.outward', toCropFraction(rec.fovCrop.outward))
  }
}

// --- Package management ---

export async function disablePackage(pkg: string): Promise<string> {
  return shell(`pm disable-user --user 0 ${pkg}`)
}

export async function enablePackage(pkg: string): Promise<string> {
  return shell(`pm enable ${pkg}`)
}

// --- System actions ---

// Filtered in JS rather than by piping through grep, so the parse is the same on all three routes.
export async function getCurrentOculusProps(): Promise<Record<string, string>> {
  const raw = await shell('getprop')
  const props: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/\[(debug\.oculus\.[^\]]+)\]:\s*\[([^\]]*)\]/)
    // The probe's scratch key is this app's, not the headset's: filtering it here keeps it out of
    // Settings Backup, "show all tweaks", the erase tally and Recording's readback at once.
    if (match && !match[1].startsWith(PROBE_PROP_PREFIX)) props[match[1]] = match[2]
  }
  return props
}

export async function openAndroidSettings(): Promise<void> {
  await modeReady
  if (mode === 'native') {
    await Apps.openSettings()
    return
  }
  await shell('am start -a android.settings.SETTINGS')
}

export async function restartQuestHome(): Promise<void> {
  await shell('am force-stop com.oculus.shellenv')
}

export async function toggleScreen(): Promise<void> {
  await shell('input keyevent KEYCODE_POWER')
}

export async function killBackground(): Promise<void> {
  await modeReady
  // killBackgroundProcesses only ever touches one package and ignores anything in the foreground,
  // so the native path sweeps the third-party list rather than claiming an `am kill-all`.
  if (mode === 'native') {
    await Apps.killBackground()
    return
  }
  await shell('am kill-all')
}
