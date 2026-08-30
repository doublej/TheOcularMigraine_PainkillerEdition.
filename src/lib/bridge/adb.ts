/**
 * ADB bridge abstraction.
 * - Native (on Quest via Capacitor): Runtime.exec() directly
 * - Desktop (browser + local server): proxies to `adb shell` on host
 * - Mock (browser, no server): returns fake responses for dev
 */

import { Capacitor } from '@capacitor/core'
import { ShellExec } from '../plugins/shell-exec'
import type { RecordingSettings } from '../stores/device.svelte'

export type Mode = 'native' | 'desktop' | 'mock'
let mode: Mode = 'mock'
let connected = true

const modeReady: Promise<void> = Capacitor.isNativePlatform()
  ? (mode = 'native', Promise.resolve())
  : fetch('/api/ping', { signal: AbortSignal.timeout(800) })
      .then(r => { if (r.ok) mode = 'desktop' })
      .catch(() => {})

export function getConnectionMode(): Mode { return mode }
export function isServerConnected(): boolean { return mode !== 'desktop' || connected }

export async function reconnect(): Promise<void> {
  if (Capacitor.isNativePlatform()) return
  try {
    const res = await fetch('/api/ping', { signal: AbortSignal.timeout(800) })
    if (res.ok) { mode = 'desktop'; connected = true }
    else { mode = 'mock'; connected = false }
  } catch {
    mode = 'mock'
    connected = false
  }
}

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
}

function getMockResponse(command: string): string {
  if (mockResponses[command] !== undefined) return mockResponses[command]
  if (command.startsWith('getprop') && command.includes('debug.oculus')) return ''
  if (command.includes('grep debug.oculus')) {
    return '[debug.oculus.textureWidth]: [1832]\n[debug.oculus.textureHeight]: [1920]\n[debug.oculus.refreshRate]: [120]\n[debug.oculus.cpuLevel]: [3]\n[debug.oculus.gpuLevel]: [3]\n[debug.oculus.ffrLevel]: [2]'
  }
  return ''
}

async function desktopShell(command: string): Promise<string> {
  const res = await fetch('/api/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  })
  const data = await res.json()
  if (data.exitCode !== 0 && data.error) {
    throw new Error(`${command}: ${data.error}`)
  }
  return data.output ?? ''
}

export async function shell(command: string): Promise<string> {
  await modeReady
  if (mode === 'native') {
    const result = await ShellExec.exec({ command })
    if (result.exitCode !== 0 && result.error) {
      throw new Error(`${command}: ${result.error}`)
    }
    return result.output
  }
  if (mode === 'desktop') {
    try {
      return await desktopShell(command)
    } catch (e) {
      if (e instanceof TypeError) {
        connected = false
        return getMockResponse(command)
      }
      throw e
    }
  }
  console.log(`[mock] ${command}`)
  return getMockResponse(command)
}

export async function setprop(prop: string, value: string | number): Promise<void> {
  await shell(`setprop ${prop} ${value}`)
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

export async function clearAllSettings(): Promise<void> {
  const raw = await shell("getprop | grep 'debug.oculus' | sed 's/\\[//g' | sed 's/\\].*//g'")
  for (const prop of raw.split('\n').filter(Boolean)) {
    await shell(`setprop ${prop.trim()} ""`)
  }
}

export async function installApk(path: string): Promise<string> {
  await modeReady
  if (mode === 'desktop') {
    const res = await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    const data = await res.json()
    return data.output || data.error || ''
  }
  return shell(`pm install -r "${path}"`)
}

export async function launchApp(packageName: string): Promise<void> {
  await shell(`monkey -p ${packageName} 1`)
}

export async function forceStop(packageName: string): Promise<void> {
  await shell(`am force-stop ${packageName}`)
}

export async function reboot(): Promise<void> {
  await shell('svc power reboot')
}

export async function getInstalledPackages(): Promise<string[]> {
  const output = await shell('pm list packages -3')
  return output.split('\n').filter(Boolean).map(l => l.replace('package:', ''))
}

export async function startRecording(): Promise<void> {
  await setprop('debug.oculus.enableVideoCapture', 1)
}

export async function stopRecording(): Promise<void> {
  await setprop('debug.oculus.enableVideoCapture', 0)
}

// --- Device info queries ---

export async function getBatteryInfo(): Promise<{ level: number; charging: boolean }> {
  const raw = await shell('dumpsys battery')
  const level = parseInt(raw.match(/level:\s*(\d+)/)?.[1] ?? '0')
  const status = parseInt(raw.match(/status:\s*(\d+)/)?.[1] ?? '0')
  return { level, charging: status === 2 || status === 5 }
}

export async function getStorageInfo(): Promise<{ free: string; total: string }> {
  const raw = await shell('df /storage/emulated/0')
  const parts = raw.split('\n')[1]?.trim().split(/\s+/)
  if (!parts || parts.length < 4) return { free: '?', total: '?' }
  const totalKb = parseInt(parts[1])
  const availKb = parseInt(parts[3])
  const fmt = (kb: number) => kb > 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : `${(kb / 1024).toFixed(0)} MB`
  return { free: fmt(availKb), total: fmt(totalKb) }
}

export async function getWifiInfo(): Promise<{ ssid: string; ip: string; signal: number }> {
  const wifiRaw = await shell('dumpsys wifi')
  const ssid = wifiRaw.match(/SSID:\s*"?([^",]+)"?/)?.[1] ?? ''
  const signal = parseInt(wifiRaw.match(/RSSI:\s*(-?\d+)/)?.[1] ?? '0')
  const ipRaw = await shell('ip addr show wlan0')
  const ip = ipRaw.match(/inet\s+([\d.]+)/)?.[1] ?? ''
  return { ssid, ip, signal }
}

export async function getFirmwareVersion(): Promise<string> {
  return getprop('ro.build.display.id')
}

export async function getCurrentDisplaySettings() {
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
  return {
    ...(w ? { resolutionWidth: parseInt(w) } : {}),
    ...(h ? { resolutionHeight: parseInt(h) } : {}),
    ...(rr ? { refreshRate: parseInt(rr) } : {}),
    ...(cpu ? { cpuLevel: parseInt(cpu) } : {}),
    ...(gpu ? { gpuLevel: parseInt(gpu) } : {}),
    ...(ffr ? { ffrLevel: parseInt(ffr) } : {}),
    ...(cpuD ? { cpuDynamic: cpuD === '1' } : {}),
    ...(gpuD ? { gpuDynamic: gpuD === '1' } : {}),
    ...(ffrD ? { ffrDynamic: ffrD === '1' } : {}),
  }
}

// --- Recording settings ---

const eyeMap = { left: 0, right: 1, both: 2 } as const

export async function applyRecordingSettings(rec: RecordingSettings): Promise<void> {
  await Promise.all([
    setprop('debug.oculus.capture.width', rec.width),
    setprop('debug.oculus.capture.height', rec.height),
    setprop('debug.oculus.capture.bitrate', rec.bitrate * 1000),
    setprop('debug.oculus.capture.fps', rec.framerate),
    setprop('debug.oculus.screenCaptureEye', eyeMap[rec.eye]),
  ])
  if (rec.fovCrop) {
    await Promise.all([
      setprop('debug.oculus.fovCrop.up', rec.fovCrop.up),
      setprop('debug.oculus.fovCrop.down', rec.fovCrop.down),
      setprop('debug.oculus.fovCrop.inward', rec.fovCrop.inward),
      setprop('debug.oculus.fovCrop.outward', rec.fovCrop.outward),
    ])
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

export async function getCurrentOculusProps(): Promise<Record<string, string>> {
  const raw = await shell("getprop | grep 'debug.oculus'")
  const props: Record<string, string> = {}
  for (const line of raw.split('\n').filter(Boolean)) {
    const match = line.match(/\[([^\]]+)\]:\s*\[([^\]]*)\]/)
    if (match) props[match[1]] = match[2]
  }
  return props
}

export async function openAndroidSettings(): Promise<void> {
  await shell('am start -a android.settings.SETTINGS')
}

export async function restartQuestHome(): Promise<void> {
  await shell('am force-stop com.oculus.shellenv')
}

export async function toggleScreen(): Promise<void> {
  await shell('input keyevent KEYCODE_POWER')
}

export async function killBackground(): Promise<void> {
  await shell('am kill-all')
}
