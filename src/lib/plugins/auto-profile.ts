import { registerPlugin } from '@capacitor/core'

/** What a profile becomes once it leaves the WebView: the props to write, already resolved. */
export interface NativeProfile {
  name: string
  props: Record<string, string>
}

export interface AutoProfileStatus {
  /** The appop is held. Without it the watcher sees no launches at all. */
  usageAccess: boolean
  /** The foreground service is up. */
  running: boolean
  /** The privileged channel is open — without it a launch is seen but nothing can be written. */
  elevated: boolean
  /** What the watcher last did, in its own words. Absent until it has done something. */
  lastMessage?: string
  lastAt?: number
}

export interface AutoProfilePlugin {
  /** Replaces the whole map, keyed by package name. */
  sync(options: { profiles: Record<string, NativeProfile> }): Promise<void>
  start(): Promise<AutoProfileStatus>
  stop(): Promise<AutoProfileStatus>
  status(): Promise<AutoProfileStatus>
  grantUsageAccess(): Promise<AutoProfileStatus>
}

export const AutoProfile = registerPlugin<AutoProfilePlugin>('AutoProfile')
