/**
 * Auto-apply: a game's profile written at the moment that game starts.
 *
 * The original does this by monitoring app launches, and it is the thing that makes profiles worth
 * having — settings that only land when you remember to open this app first are settings you will
 * forget. The watcher itself is native (see LaunchWatcherService); this module is the seam.
 *
 * Off the headset every call is a no-op reporting "nothing is watching", which is true: there is no
 * service, no usage access and no headset to write to.
 */
import { Capacitor } from '@capacitor/core'
import { AutoProfile, type AutoProfileStatus, type NativeProfile } from '../plugins/auto-profile'
import { DISPLAY_PROPS } from './adb'
import type { DisplaySettings, GameProfile } from '../stores/device.svelte'

const NOT_ON_HEADSET: AutoProfileStatus = { usageAccess: false, running: false, elevated: false }

/** True only where a service can exist. Every other route answers honestly instead of pretending. */
export function canAutoApply(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Resolves a profile to the props it would write, here rather than in Java, so DISPLAY_PROPS stays
 * the single place that knows which prop carries which setting. Booleans go out as 1/0, exactly as
 * writeDisplayPartial sends them, and a key the profile does not hold is not written at all.
 */
function propsOf(display: Partial<DisplaySettings>): Record<string, string> {
  const props: Record<string, string> = {}
  for (const key of Object.keys(DISPLAY_PROPS) as (keyof DisplaySettings)[]) {
    const value = display[key]
    if (value === undefined) continue
    props[DISPLAY_PROPS[key]] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
  return props
}

/**
 * Mirrors the profiles marked auto-apply into the service's own store.
 *
 * Only one profile per package can be the automatic one — the rest stay manual, which is the
 * original's rule too: extra profiles are loaded by hand and bypass the default.
 */
export async function syncProfiles(profiles: GameProfile[]): Promise<void> {
  if (!canAutoApply()) return
  const map: Record<string, NativeProfile> = {}
  for (const profile of profiles) {
    if (!profile.isDefault) continue
    map[profile.packageName] = { name: profile.name, props: propsOf(profile.display) }
  }
  await AutoProfile.sync({ profiles: map })
}

export async function getStatus(): Promise<AutoProfileStatus> {
  if (!canAutoApply()) return NOT_ON_HEADSET
  return AutoProfile.status()
}

export async function startWatching(): Promise<AutoProfileStatus> {
  if (!canAutoApply()) return NOT_ON_HEADSET
  return AutoProfile.start()
}

export async function stopWatching(): Promise<AutoProfileStatus> {
  if (!canAutoApply()) return NOT_ON_HEADSET
  return AutoProfile.stop()
}

export async function grantUsageAccess(): Promise<AutoProfileStatus> {
  if (!canAutoApply()) return NOT_ON_HEADSET
  return AutoProfile.grantUsageAccess()
}
