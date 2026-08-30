import * as adb from '../bridge/adb'
import type { Mode } from '../bridge/adb'
import { abilitiesFor, type Abilities, type Privilege } from '../bridge/capabilities'
import * as persistence from './persistence'

export interface DeviceInfo {
  name: string
  model: string
  ip: string
  ssid: string
  signalStrength: number
  battery: number
  charging: boolean
  freeSpace: string
  totalSpace: string
  firmwareVersion: string
}

export interface DisplaySettings {
  resolutionWidth: number
  resolutionHeight: number
  refreshRate: number
  cpuLevel: number
  gpuLevel: number
  ffrLevel: number
  cpuDynamic: boolean
  gpuDynamic: boolean
  ffrDynamic: boolean
}

export interface RecordingSettings {
  width: number
  height: number
  bitrate: number
  framerate: number
  eye: 'left' | 'right' | 'both'
  fovCrop: { up: number; down: number; inward: number; outward: number }
  swapInterval: number
  adaclocks: boolean
}

export interface GameProfile {
  id: string
  name: string
  packageName: string
  display: DisplaySettings
  recording?: RecordingSettings
  isDefault: boolean
}

/** What one headset model actually accepts. Anything outside this is written and silently ignored. */
export interface ModelCaps {
  label: string
  refreshRates: number[]
  nativeWidth: number
  nativeHeight: number
  /**
   * False when ro.product.model matched nothing known, which includes "not read yet" — every
   * number in this object is then a conservative guess, not this headset's capabilities.
   *
   * A view MUST NOT state them as fact while this is false: no "Native" resolution rung, no
   * "this headset only runs 72 Hz". Offer them as a fallback, say they are unverified, and let
   * the user pick anyway — setprop will not argue back, so the app has to.
   */
  known: boolean
  /**
   * True when `refreshRates` was confirmed against what the headset itself reports, rather than
   * taken from the model-name table above. A name is not a measurement, and this is the difference.
   */
  ratesMeasured: boolean
  /**
   * The highest rate the headset reports, when that is above everything Meta documents for the
   * model. Meta lists extended rates (any integer above 120, up to 207) as Quest 3 only — so a
   * headset that reports one has had its ceiling raised, and hiding that would be the same failure
   * as inventing one. 0 when there is nothing beyond the documented set.
   */
  extendedMax: number
}

/**
 * The rates Meta documents as selectable, per model.
 *
 * Straight from the "Set Display Refresh Rates" table in Meta's Horizon OS developer docs. The
 * previous list here was guessed and wrong on four of the five models: it omitted 80, 96 and 100 Hz
 * everywhere they exist, so three quarters of the Quest 3's usable rates were never offered.
 *
 * 60 Hz is deliberately absent. The table marks it "media apps only" on Quest 1 and 2, and this app
 * tunes VR — offering it would be offering a rate the runtime will not give a VR title.
 */
// Matched on a lowercased substring: ro.product.model carries prefixes such as 'Meta Quest 3'.
const MODEL_CAPS: { match: string; caps: ModelCaps }[] = [
  { match: 'quest pro', caps: { label: 'Quest Pro', refreshRates: [72, 80, 90], nativeWidth: 1800, nativeHeight: 1920, known: true, ratesMeasured: false, extendedMax: 0 } },
  // The 3S keeps the Quest 2 LCD stack; only the 3 has the 2064x2208 panels.
  { match: 'quest 3s', caps: { label: 'Quest 3S', refreshRates: [72, 80, 90, 96, 100, 120], nativeWidth: 1832, nativeHeight: 1920, known: true, ratesMeasured: false, extendedMax: 0 } },
  { match: 'quest 3', caps: { label: 'Quest 3', refreshRates: [72, 80, 90, 96, 100, 120], nativeWidth: 2064, nativeHeight: 2208, known: true, ratesMeasured: false, extendedMax: 0 } },
  { match: 'quest 2', caps: { label: 'Quest 2', refreshRates: [72, 80, 90, 96, 100, 120], nativeWidth: 1832, nativeHeight: 1920, known: true, ratesMeasured: false, extendedMax: 0 } },
  { match: 'quest', caps: { label: 'Quest 1', refreshRates: [72], nativeWidth: 1440, nativeHeight: 1600, known: true, ratesMeasured: false, extendedMax: 0 } },
]

const UNKNOWN_CAPS: ModelCaps = {
  label: 'Unknown headset',
  refreshRates: [72],
  nativeWidth: 1832,
  nativeHeight: 1920,
  known: false,
  ratesMeasured: false,
  extendedMax: 0,
}

export function getModelCaps(model: string): ModelCaps {
  const needle = model.toLowerCase()
  return MODEL_CAPS.find(m => needle.includes(m.match))?.caps ?? UNKNOWN_CAPS
}

/**
 * What the headset said when asked, or [] when it was never asked or could not answer.
 *
 * Display.getSupportedModes() needs no permission, so even an unelevated headset install can read
 * this — which makes the model-name table a fallback rather than the source of truth.
 */
let reportedRates = $state<number[]>([])

/**
 * The model's documented rates, narrowed to the ones this headset actually reports.
 *
 * Two different mistakes are avoided here. Offering a documented rate the headset does not report
 * would assert a capability that was never seen. Offering every rate it does report would be worse
 * in the other direction: a Quest 3 enumerates all 49 integers from 72 to 120, and a 49-button
 * picker is not a truthful UI, it is an unusable one. So the buttons are the documented rungs,
 * confirmed present — plus the reported ceiling when it exceeds anything Meta documents.
 */
export function resolveCaps(model: string, reported: number[]): ModelCaps {
  const base = getModelCaps(model)
  if (reported.length === 0) return base

  const confirmed = base.refreshRates.filter(hz => reported.includes(hz))
  const documentedMax = Math.max(...base.refreshRates)
  const reportedMax = Math.max(...reported)
  const extendedMax = reportedMax > documentedMax ? reportedMax : 0
  // An extended ceiling becomes one extra rung rather than every integer up to it.
  const rates = extendedMax ? [...confirmed, extendedMax] : confirmed

  // A headset that reports nothing in common with its own model's table is stranger than an
  // unknown model, so fall back rather than render an empty picker.
  if (rates.length === 0) return base

  return { ...base, refreshRates: rates, ratesMeasured: true, extendedMax }
}

export function getCapsForModel(model: string): ModelCaps {
  return resolveCaps(model, reportedRates)
}

let device = $state<DeviceInfo>({
  name: '',
  model: '',
  ip: '',
  ssid: '',
  signalStrength: 0,
  battery: 0,
  charging: false,
  freeSpace: '',
  totalSpace: '',
  firmwareVersion: '',
})

const defaultDisplay: DisplaySettings = {
  resolutionWidth: 1832,
  resolutionHeight: 1920,
  refreshRate: 72,
  cpuLevel: 3,
  gpuLevel: 3,
  ffrLevel: 2,
  cpuDynamic: true,
  gpuDynamic: true,
  ffrDynamic: false,
}

const defaultRecording: RecordingSettings = {
  width: 1920,
  height: 1080,
  bitrate: 20000,
  framerate: 60,
  eye: 'left',
  fovCrop: { up: 0, down: 0, inward: 0, outward: 0 },
  swapInterval: 1,
  adaclocks: true,
}

const DISPLAY_KEYS = Object.keys(defaultDisplay) as (keyof DisplaySettings)[]

/** Merged, never adopted whole: a blob saved by an older version can be missing keys the views read. */
export function mergeRecording(saved: Partial<RecordingSettings> | null | undefined): RecordingSettings {
  return { ...defaultRecording, ...saved, fovCrop: { ...defaultRecording.fovCrop, ...saved?.fovCrop } }
}

function mergeDisplay(saved: Partial<DisplaySettings> | null | undefined): DisplaySettings {
  return { ...defaultDisplay, ...saved }
}

/** Same rule as recording: a profile saved by an older version can be missing whole sections. */
function mergeProfile(saved: Partial<GameProfile> | null | undefined): GameProfile | null {
  // Without these two there is nothing to apply and nothing to delete by, so the row is unusable.
  if (!saved?.id || !saved.packageName) return null
  return {
    id: saved.id,
    name: saved.name || saved.packageName,
    packageName: saved.packageName,
    display: mergeDisplay(saved.display),
    recording: saved.recording ? mergeRecording(saved.recording) : undefined,
    isDefault: saved.isDefault === true,
  }
}

function displayDefaultsFor(caps: ModelCaps): DisplaySettings {
  return {
    ...defaultDisplay,
    resolutionWidth: caps.nativeWidth,
    resolutionHeight: caps.nativeHeight,
    refreshRate: Math.max(...caps.refreshRates),
  }
}

const savedDisplay = persistence.loadDisplaySettings()
const savedUnset = persistence.loadUnsetDisplayKeys()
const savedProfiles = persistence.loadGameProfiles()

let display = $state<DisplaySettings>(mergeDisplay(savedDisplay))
let recording = $state<RecordingSettings>(mergeRecording(persistence.loadRecordingSettings()))
// A value is device state only once it was written to the headset or read back from it. The saved
// blob holds all nine keys either way, so the guesses are told apart by the list saved beside it;
// a blob from a version that kept no such list is all guesses, not confirmed device state.
let unsetDisplayKeys = $state<(keyof DisplaySettings)[]>(
  savedDisplay && Array.isArray(savedUnset)
    ? DISPLAY_KEYS.filter(k => savedUnset.includes(k))
    : [...DISPLAY_KEYS],
)

let profiles = $state<GameProfile[]>(
  (Array.isArray(savedProfiles) ? savedProfiles : [])
    .map(mergeProfile)
    .filter((p): p is GameProfile => p !== null),
)

let connectionMode = $state<Mode>('mock')
let serverConnected = $state(true)
let deviceInfoIsFixture = $state(false)
// What this route runs as, which is not what the mode says: a sideloaded app cannot write render
// props even though its commands reach the headset. Never persisted — see probePrivilege().
let connectionPrivilege = $state<Privilege>('none')
const abilities = $derived(abilitiesFor(connectionPrivilege))

export function getDevice() { return device }
export function getDisplay() { return display }
export function getRecording() { return recording }
export function getProfiles() { return profiles }
export function getConnectionMode() { return connectionMode }
export function getServerConnected() { return serverConnected }
export function getPrivilege(): Privilege { return connectionPrivilege }

/**
 * What this route can actually do. Gate a control that would fail on tap; this is the pre-flight
 * question, and does not replace the fixture/unset honesty machinery, which is the post-hoc audit.
 */
export function getAbilities(): Abilities { return abilities }

/** Capabilities of the headset that is actually attached — check `.known` before stating any of them. */
export function getCaps(): ModelCaps { return resolveCaps(device.model, reportedRates) }

/**
 * True when everything in getDevice() came from mock fixtures rather than a headset. The views
 * must render it as demo data or as unknown — never as this headset's model, battery or network.
 */
export function isDeviceInfoFixture(): boolean { return deviceInfoIsFixture }

/** True when there is no headset behind the app: every write is discarded. */
export function isDemoMode(): boolean { return connectionMode === 'mock' }

/** Display props the headset has no value for — show 'headset default', not the number underneath. */
export function getUnsetDisplayKeys(): (keyof DisplaySettings)[] { return unsetDisplayKeys }

export function refreshConnectionState() {
  connectionMode = adb.getConnectionMode()
  serverConnected = adb.isServerConnected()
  connectionPrivilege = adb.getPrivilege()
}

adb.setConnectionListener(refreshConnectionState)

// Native privilege is not knowable up front, so the app asks the headset once at launch instead of
// assuming either way. Everything else short-circuits inside the probe.
void adb.probePrivilege().then(refreshConnectionState)

export function updateDisplay(patch: Partial<DisplaySettings>) {
  Object.assign(display, patch)
  // Only the keys in this patch were actually written, so only they stop being a guess.
  unsetDisplayKeys = unsetDisplayKeys.filter(k => !(k in patch))
  persistence.saveDisplaySettings(display)
  persistence.saveUnsetDisplayKeys(unsetDisplayKeys)
}

export function updateRecording(patch: Partial<RecordingSettings>) {
  Object.assign(recording, patch)
  persistence.saveRecordingSettings(recording)
}

export function addProfile(profile: GameProfile) {
  profiles.push(profile)
  persistence.saveGameProfiles(profiles)
}

export function removeProfile(id: string) {
  const idx = profiles.findIndex(p => p.id === id)
  if (idx >= 0) {
    profiles.splice(idx, 1)
    persistence.saveGameProfiles(profiles)
  }
}

export async function refreshDevice() {
  // Settled, not all: shell() throws on any nonzero exit, and one missing prop — `ip addr show
  // wlan0` on a headset with no wlan0 — must not discard the other five reads.
  const results = await Promise.allSettled([
    adb.getModel(),
    adb.getBatteryInfo(),
    adb.getStorageInfo(),
    adb.getWifiInfo(),
    adb.getFirmwareVersion(),
    adb.getCurrentDisplaySettings(),
    adb.getReportedRefreshRates(),
  ])
  // Every read failing is the bridge being down, not six broken props: that is still an error.
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length === results.length) throw failed[0].reason

  const [model, battery, storage, wifi, firmware, readback, rates] = results
  const value = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)
  // A failed read is unknown, never the last known value: the views render '' and 0 as '—'.
  device.model = value(model) ?? ''
  device.battery = value(battery)?.level ?? 0
  device.charging = value(battery)?.charging ?? false
  device.freeSpace = value(storage)?.free ?? ''
  device.totalSpace = value(storage)?.total ?? ''
  device.ip = value(wifi)?.ip ?? ''
  device.ssid = value(wifi)?.ssid ?? ''
  device.signalStrength = value(wifi)?.signal ?? 0
  device.firmwareVersion = value(firmware) ?? ''
  // [] means "not read", never "supports nothing" — resolveCaps falls back to the table on empty.
  reportedRates = value(rates) ?? []
  // Everything above may have come from fixtures; the views need to know before they show it.
  deviceInfoIsFixture = adb.isFixtureRead()

  // Fixtures are not a readback: every mock getprop answers with a value, so adopting one would
  // empty `unset` and present nine invented numbers as confirmed device state.
  const read = deviceInfoIsFixture ? null : value(readback)
  if (read) {
    // Props the headset never had fall back to what this model supports, and stay flagged as unset.
    const fallback = displayDefaultsFor(resolveCaps(device.model, reportedRates))
    const seeded = Object.fromEntries(read.unset.map(key => [key, fallback[key]]))
    Object.assign(display, read.values, seeded)
    unsetDisplayKeys = read.unset
    // Deliberately not persisted: a device read must never overwrite the settings the user saved.
  }
  refreshConnectionState()
}
