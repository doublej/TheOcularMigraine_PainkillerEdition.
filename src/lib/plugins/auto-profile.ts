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

/**
 * The three permissions the bootstrap grants, each read live rather than remembered.
 *
 * A grant can be refused when it is asked for, or revoked from outside the app afterwards, and
 * either way the only symptom is a feature that quietly stops working.
 */
export interface Grants {
  /** Exempt from doze. Without it the Quest kills the launch watcher soon after install. */
  doze: boolean
  /** The appop the watcher needs to see a launch at all. */
  usageAccess: boolean
  /** Held, but inert on this firmware — see AdbChannel.makeAccessPermanent. */
  secureSettings: boolean
}

export interface AutoProfilePlugin {
  /** Replaces the whole map, keyed by package name. */
  sync(options: { profiles: Record<string, NativeProfile> }): Promise<void>
  start(): Promise<AutoProfileStatus>
  stop(): Promise<AutoProfileStatus>
  status(): Promise<AutoProfileStatus>
  grantUsageAccess(): Promise<AutoProfileStatus>
  grants(): Promise<Grants>
  /** Re-runs the bootstrap through the channel, then answers with what it changed. */
  repairGrants(): Promise<Grants>
}

export const AutoProfile = registerPlugin<AutoProfilePlugin>('AutoProfile')
