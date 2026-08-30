import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * Where the privileged connection got to. Each one is detected, never guessed — in particular adbd
 * sends no signal when someone declines the prompt, so REJECTED_OR_IGNORED can only ever mean
 * "declined, or never appeared".
 */
export type ElevationState =
  | 'DEV_MODE_OFF'
  | 'NO_PORT'
  | 'PORT_OPEN_UNAUTHORIZED'
  | 'AWAITING_USER'
  | 'REJECTED_OR_IGNORED'
  | 'CONNECTED'
  | 'DROPPED'
  | 'UNSUPPORTED'

export interface Elevation {
  state: ElevationState
  detail: string
  port?: number
}

export interface ShellExecPlugin {
  exec(options: { command: string }): Promise<{
    output: string
    error: string
    exitCode: number
    /** What actually ran the command. Additive — the other three fields are unchanged. */
    via?: 'app' | 'adb'
  }>
  elevationState(): Promise<Elevation>
  elevate(): Promise<Elevation>
  disconnect(): Promise<Elevation>
  addListener(
    event: 'elevationChange',
    handler: (payload: Elevation) => void,
  ): Promise<PluginListenerHandle>
}

export const ShellExec = registerPlugin<ShellExecPlugin>('ShellExec')

export interface NativeDeviceInfo {
  model: string
  manufacturer: string
  firmware: string
  securityPatch: string
  sdkInt: number
  batteryLevel: number
  charging: boolean
  freeBytes: number
  totalBytes: number
  ip: string
}

export interface NativeWifiInfo {
  ssid: string
  signal: number
  /** True when Android withheld the name because the location permission is not granted. */
  ssidHidden: boolean
}

export interface NativeDisplay {
  displayId: number
  name: string
  isDefault: boolean
  activeRate: number
  /** Distinct refresh rates this display reports, sorted, rounded to whole Hz. */
  rates: number[]
  modeCount: number
}

export interface DeviceInfoPlugin {
  info(): Promise<NativeDeviceInfo>
  wifi(): Promise<NativeWifiInfo>
  displayModes(): Promise<{ displays: NativeDisplay[] }>
}

export const DeviceInfo = registerPlugin<DeviceInfoPlugin>('DeviceInfo')

export interface NativeApp {
  packageName: string
  label: string
  versionName: string
  enabled: boolean
  /** A 48px PNG data URI, or '' when the icon could not be rendered. */
  icon?: string
}

export interface AppsPlugin {
  list(options?: { icons?: boolean }): Promise<{ apps: NativeApp[] }>
  launch(options: { packageName: string }): Promise<{ launched: string }>
  install(options: { path: string }): Promise<{ handedOff: boolean }>
  /** '' clears it. Answers with what is stored, which is not always what was asked for. */
  setStartupApp(options: { packageName: string }): Promise<{ packageName: string }>
  getStartupApp(): Promise<{ packageName: string }>
  openSettings(): Promise<void>
  killBackground(): Promise<{ asked: number }>
}

export const Apps = registerPlugin<AppsPlugin>('Apps')

export interface FileServerStatus {
  running: boolean
  port: number
  root: string
  uploads: boolean
  /** False when Android has not granted All files access — a shared folder would read empty. */
  canRead: boolean
}

export interface FileServerPlugin {
  start(options: { root?: string; uploads?: boolean }): Promise<FileServerStatus>
  stop(): Promise<FileServerStatus>
  status(): Promise<FileServerStatus>
}

export const FileServer = registerPlugin<FileServerPlugin>('FileServer')
