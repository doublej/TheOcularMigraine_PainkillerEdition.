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

export interface DeviceInfoPlugin {
  info(): Promise<NativeDeviceInfo>
  wifi(): Promise<NativeWifiInfo>
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
  openSettings(): Promise<void>
  killBackground(): Promise<{ asked: number }>
}

export const Apps = registerPlugin<AppsPlugin>('Apps')
