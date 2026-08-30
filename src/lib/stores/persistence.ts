import type { DisplaySettings, RecordingSettings } from './device.svelte'

export interface DisplayPreset {
  id: string
  name: string
  settings: DisplaySettings
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

const KEYS = {
  PRESETS: 'tom_display_presets',
  REC_PROFILES: 'tom_recording_profiles',
  SCRIPTS: 'tom_user_scripts',
  SETTINGS_BACKUP: 'tom_settings_backup',
  STARTUP_APP: 'tom_startup_app',
  KIOSK_APP: 'tom_kiosk_app',
  WHITELIST: 'tom_whitelist',
  BLACKLIST: 'tom_blacklist',
  DISPLAY: 'tom_display_settings',
  RECORDING: 'tom_recording_settings',
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

export const loadPresets = () => load<DisplayPreset[]>(KEYS.PRESETS, [])
export const savePresets = (p: DisplayPreset[]) => save(KEYS.PRESETS, p)

export const loadRecordingProfiles = () => load<RecordingProfile[]>(KEYS.REC_PROFILES, [])
export const saveRecordingProfiles = (p: RecordingProfile[]) => save(KEYS.REC_PROFILES, p)

export const loadUserScripts = () => load<(UserScript | null)[]>(KEYS.SCRIPTS, [null, null, null, null])
export const saveUserScripts = (s: (UserScript | null)[]) => save(KEYS.SCRIPTS, s)

export const saveSettingsBackup = (props: Record<string, string>) => save(KEYS.SETTINGS_BACKUP, props)
export const loadSettingsBackup = () => load<Record<string, string> | null>(KEYS.SETTINGS_BACKUP, null)

export const getStartupApp = () => load<string>(KEYS.STARTUP_APP, '')
export const setStartupApp = (pkg: string) => save(KEYS.STARTUP_APP, pkg)

export const getKioskApp = () => load<string>(KEYS.KIOSK_APP, '')
export const setKioskApp = (pkg: string) => save(KEYS.KIOSK_APP, pkg)

export const getWhitelist = () => load<string[]>(KEYS.WHITELIST, [])
export const setWhitelist = (pkgs: string[]) => save(KEYS.WHITELIST, pkgs)

export const getBlacklist = () => load<string[]>(KEYS.BLACKLIST, [])
export const setBlacklist = (pkgs: string[]) => save(KEYS.BLACKLIST, pkgs)

export const loadDisplaySettings = () => load<DisplaySettings | null>(KEYS.DISPLAY, null)
export const saveDisplaySettings = (s: DisplaySettings) => save(KEYS.DISPLAY, s)

export const loadRecordingSettings = () => load<RecordingSettings | null>(KEYS.RECORDING, null)
export const saveRecordingSettings = (s: RecordingSettings) => save(KEYS.RECORDING, s)
