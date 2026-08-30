/**
 * What a route can actually do, kept apart from where its commands go.
 *
 * `Mode` says where a command is sent. It never said whether the command can work, which is why a
 * sideloaded build could present a full Tune tab that changed nothing. Measured on a Quest 3
 * (Android 14, SDK 34) running as the app's own uid: `setprop debug.oculus.*` is refused, `am`,
 * `pm disable-user`, `monkey`, `svc` and `input` are refused on signature permissions, and
 * `dumpsys battery` answers "Can't find service" — while `getprop` and `pm list packages -3` work.
 * Over `adb shell` all of them work. So privilege is its own axis, and this table is that matrix.
 */

/** Where a command is sent. */
export type Mode = 'native' | 'desktop' | 'mock'

/** What it runs as once it gets there. `none` is the mock table; `app` is an unelevated sideload. */
export type Privilege = 'shell' | 'app' | 'none'

export type AbilityKey =
  | 'readProps'
  | 'writeProps'
  | 'listPackages'
  | 'controlApps'
  | 'deviceServices'
  | 'installApk'

export type Abilities = Record<AbilityKey, boolean>

const NOTHING: Abilities = {
  readProps: false,
  writeProps: false,
  listPackages: false,
  controlApps: false,
  deviceServices: false,
  installApk: false,
}

const AS_APP: Abilities = { ...NOTHING, readProps: true, listPackages: true }

const AS_SHELL: Abilities = {
  readProps: true,
  writeProps: true,
  listPackages: true,
  controlApps: true,
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
  controlApps: 'Start, stop and disable apps',
  deviceServices: 'Read battery, Wi‑Fi and storage',
  installApk: 'Install an APK',
}

export function abilityLabel(key: AbilityKey): string {
  return LABELS[key]
}

const NO_HEADSET = 'Nothing is connected, so this would not reach a headset.'

// Only reached at privilege 'app': a sideloaded build running as itself.
const UNELEVATED: Record<AbilityKey, string> = {
  readProps: '',
  listPackages: '',
  writeProps: 'Android only lets the adb shell user change these, and the app runs as itself.',
  controlApps: 'Starting, stopping and disabling other apps needs a permission only adb shell holds.',
  deviceServices: 'The battery, Wi‑Fi and storage services refuse a plain app; only adb shell may ask them.',
  installApk: 'Installing needs adb — an app cannot silently install another app.',
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
    abilitiesFor('app').readProps && abilitiesFor('app').listPackages,
    'an unelevated app can still read props and list packages',
  )
  console.assert(
    !abilitiesFor('app').writeProps && !abilitiesFor('app').controlApps &&
      !abilitiesFor('app').deviceServices && !abilitiesFor('app').installApk,
    'an unelevated app can do nothing else',
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
