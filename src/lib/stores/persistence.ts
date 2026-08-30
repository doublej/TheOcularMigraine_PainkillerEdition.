import type { DisplaySettings, GameProfile, RecordingSettings } from './device.svelte'

export interface DisplayPreset {
  id: string
  name: string
  settings: DisplaySettings
}

/** One snapshot of the headset's debug.oculus props, taken by Settings Backup. */
export interface SettingsSnapshot {
  id: string
  takenAt: number
  props: Record<string, string>
}

export interface RecordingProfile {
  id: string
  name: string
  settings: RecordingSettings
}

export interface UserScript {
  slot: number
  name: string
  command: string
}

/** Access Control is one exclusive mode, never two toggles that can both be on. */
export type AccessMode = 'off' | 'allow' | 'block'

const KEYS = {
  PRESETS: 'tom_display_presets',
  GAME_PROFILES: 'tom_game_profiles',
  ACCESS_MODE: 'tom_access_mode',
  REC_PROFILES: 'tom_recording_profiles',
  SCRIPTS: 'tom_user_scripts',
  SETTINGS_BACKUP: 'tom_settings_backup',
  STARTUP_APP: 'tom_startup_app',
  KIOSK_APP: 'tom_kiosk_app',
  WHITELIST: 'tom_whitelist',
  BLACKLIST: 'tom_blacklist',
  DISPLAY: 'tom_display_settings',
  DISPLAY_UNSET: 'tom_display_unset',
  RECORDING: 'tom_recording_settings',
  SETUP_SEEN: 'tom_setup_seen',
} as const

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

/** crypto.randomUUID is undefined outside a secure context, which is exactly how the phone reaches the dev bridge. */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const loadPresets = () => load<DisplayPreset[]>(KEYS.PRESETS, [])
export const savePresets = (p: DisplayPreset[]) => save(KEYS.PRESETS, p)

export const loadGameProfiles = () => load<GameProfile[]>(KEYS.GAME_PROFILES, [])
export const saveGameProfiles = (p: GameProfile[]) => save(KEYS.GAME_PROFILES, p)

export const loadRecordingProfiles = () => load<RecordingProfile[]>(KEYS.REC_PROFILES, [])
export const saveRecordingProfiles = (p: RecordingProfile[]) => save(KEYS.REC_PROFILES, p)

export const loadUserScripts = () => load<(UserScript | null)[]>(KEYS.SCRIPTS, [null, null, null, null])
export const saveUserScripts = (s: (UserScript | null)[]) => save(KEYS.SCRIPTS, s)

const MAX_SNAPSHOTS = 3

/**
 * Erasing leaves every debug.oculus prop present but empty, so a props map can be full of keys and
 * still restore nothing. Only the keys holding a value are worth keeping.
 */
function nonEmptyProps(props: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(props ?? {}).filter(([, value]) => value !== ''))
}

export function loadSettingsBackups(): SettingsSnapshot[] {
  const raw = load<unknown>(KEYS.SETTINGS_BACKUP, [])
  if (Array.isArray(raw)) return raw as SettingsSnapshot[]
  // A single unversioned blob from an earlier version becomes the oldest snapshot.
  const props = nonEmptyProps(raw as Record<string, string>)
  return Object.keys(props).length ? [{ id: 'legacy', takenAt: 0, props }] : []
}

/**
 * Returns null when there was nothing worth snapshotting, so a capture taken after an erase — all
 * keys present, all values blank — is neither stored nor able to push the last good copy out of
 * the ring. Only the props that hold a value are kept, because only those can be restored.
 */
export function saveSettingsBackup(props: Record<string, string>): SettingsSnapshot | null {
  const kept = nonEmptyProps(props)
  if (Object.keys(kept).length === 0) return null
  const snapshot: SettingsSnapshot = { id: makeId(), takenAt: Date.now(), props: kept }
  save(KEYS.SETTINGS_BACKUP, [snapshot, ...loadSettingsBackups()].slice(0, MAX_SNAPSHOTS))
  return snapshot
}

export const loadSettingsBackup = () => loadSettingsBackups()[0]?.props ?? null

export const getStartupApp = () => load<string>(KEYS.STARTUP_APP, '')
export const setStartupApp = (pkg: string) => save(KEYS.STARTUP_APP, pkg)

export const getKioskApp = () => load<string>(KEYS.KIOSK_APP, '')
export const setKioskApp = (pkg: string) => save(KEYS.KIOSK_APP, pkg)

export const getAccessMode = () => load<AccessMode>(KEYS.ACCESS_MODE, 'off')
export const setAccessMode = (m: AccessMode) => save(KEYS.ACCESS_MODE, m)

export const getWhitelist = () => load<string[]>(KEYS.WHITELIST, [])
export const setWhitelist = (pkgs: string[]) => save(KEYS.WHITELIST, pkgs)

export const getBlacklist = () => load<string[]>(KEYS.BLACKLIST, [])
export const setBlacklist = (pkgs: string[]) => save(KEYS.BLACKLIST, pkgs)

export const loadDisplaySettings = () => load<DisplaySettings | null>(KEYS.DISPLAY, null)
export const saveDisplaySettings = (s: DisplaySettings) => save(KEYS.DISPLAY, s)

/**
 * Which display keys are still this app's guess. Saved beside the values because the blob holds
 * all nine either way, so without this a guessed value comes back as confirmed device state.
 */
export const loadUnsetDisplayKeys = () => load<string[] | null>(KEYS.DISPLAY_UNSET, null)
export const saveUnsetDisplayKeys = (keys: string[]) => save(KEYS.DISPLAY_UNSET, keys)

/**
 * Whether the setup wizard has ever been dismissed. Only this flag is stored — never the
 * capability it verified, because `adb tcpip` does not survive a reboot and a saved 'shell'
 * would be a confident lie on the next launch.
 */
export const getSetupSeen = () => load<boolean>(KEYS.SETUP_SEEN, false)
export const setSetupSeen = (seen: boolean) => save(KEYS.SETUP_SEEN, seen)

export const loadRecordingSettings = () => load<RecordingSettings | null>(KEYS.RECORDING, null)
export const saveRecordingSettings = (s: RecordingSettings) => save(KEYS.RECORDING, s)
