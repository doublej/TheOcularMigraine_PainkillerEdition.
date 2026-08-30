/**
 * What a route can actually do, kept apart from where its commands go.
 *
 * `Mode` says where a command is sent. It never said whether the command can work, which is why a
 * sideloaded build could present a full Tune tab that changed nothing.
 *
 * Measured on a Quest 3 (Android 14, SDK 34) running as the app's own uid: `setprop
 * debug.oculus.*` is refused, `am`, `pm disable-user`, `monkey`, `svc` and `input` are refused on
 * signature permissions, and `dumpsys battery` answers "Can't find service". Over `adb shell` all
 * of them work.
 *
 * But most of that was the app shelling out for things Android hands an ordinary app directly.
 * Battery, storage, address, the installed-app list, launching, installing and closing background
 * apps all go through framework APIs now, so an unelevated headset install can do them. What is
 * left genuinely needs the shell uid: writing render properties, and forcing another app to stop,
 * be disabled, or the device to reboot.
 */

/** Where a command is sent. */
export type Mode = 'native' | 'desktop' | 'mock'

/** What it runs as once it gets there. `none` is the mock table; `app` is an unelevated sideload. */
export type Privilege = 'shell' | 'app' | 'none'

export type AbilityKey =
  | 'readProps'
  | 'writeProps'
  | 'listPackages'
  | 'launchApps'
  | 'manageApps'
  | 'deviceServices'
  | 'installApk'

export type Abilities = Record<AbilityKey, boolean>

const NOTHING: Abilities = {
  readProps: false,
  writeProps: false,
  listPackages: false,
  launchApps: false,
  manageApps: false,
  deviceServices: false,
  installApk: false,
}

// An unelevated app on the headset. Everything here is a framework call or a permitted getprop.
const AS_APP: Abilities = {
  ...NOTHING,
  readProps: true,
  listPackages: true,
  launchApps: true,
  deviceServices: true,
  installApk: true,
}

const AS_SHELL: Abilities = {
  readProps: true,
  writeProps: true,
  listPackages: true,
  launchApps: true,
  manageApps: true,
  deviceServices: true,
  installApk: true,
}

export function abilitiesFor(privilege: Privilege): Abilities {
  return privilege === 'shell' ? AS_SHELL : privilege === 'app' ? AS_APP : NOTHING
}

const LABELS: Record<AbilityKey, string> = {
  readProps: 'Read the headset’s settings',
  writeProps: 'Change performance and recording settings',
  listPackages: 'List installed apps',
  launchApps: 'Open an app',
  manageApps: 'Stop, disable and reboot',
  deviceServices: 'Read battery, Wi‑Fi and storage',
  installApk: 'Install an APK',
}

export function abilityLabel(key: AbilityKey): string {
  return LABELS[key]
}

const NO_HEADSET = 'Nothing is connected, so this would not reach a headset.'

// Only reached at privilege 'app': a headset install that has not been unlocked yet. Each of these
// says what to do about it, not only that it is blocked.
const UNELEVATED: Record<AbilityKey, string> = {
  readProps: '',
  listPackages: '',
  launchApps: '',
  deviceServices: '',
  installApk: '',
  writeProps:
    'Only the adb shell user may write these, and the app runs as itself. Unlocking it takes a computer once per headset restart — Set up walks you through it.',
  manageApps:
    'Stopping or disabling another app, and rebooting, need a permission only adb shell holds. Unlocking takes a computer once per headset restart — Set up walks you through it.',
}

/** One sentence saying why an ability is missing. Empty when it is not missing; only render it when false. */
export function whyNot(key: AbilityKey, privilege: Privilege): string {
  if (abilitiesFor(privilege)[key]) return ''
  return privilege === 'none' ? NO_HEADSET : UNELEVATED[key]
}

if (import.meta.env.DEV) {
  const keys = Object.keys(NOTHING) as AbilityKey[]
  // The table has to match the measured matrix, not merely be self-consistent.
  console.assert(keys.every(k => !abilitiesFor('none')[k]), 'demo can do nothing')
  console.assert(keys.every(k => abilitiesFor('shell')[k]), 'adb shell can do everything')
  console.assert(
    !abilitiesFor('app').writeProps && !abilitiesFor('app').manageApps,
    'an unelevated headset install cannot write props or manage other apps',
  )
  console.assert(
    keys
      .filter(k => k !== 'writeProps' && k !== 'manageApps')
      .every(k => abilitiesFor('app')[k]),
    'everything else has a framework path that needs no elevation',
  )
  // Every false must be explainable, and no true may carry an explanation the UI would then show.
  for (const p of ['none', 'app', 'shell'] as Privilege[]) {
    for (const k of keys) {
      console.assert(
        abilitiesFor(p)[k] ? whyNot(k, p) === '' : whyNot(k, p) !== '',
        `whyNot(${k}, ${p}) must be set exactly when the ability is missing`,
      )
      console.assert(abilityLabel(k) !== '', `${k} needs a label`)
    }
  }
}
