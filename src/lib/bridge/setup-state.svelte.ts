/**
 * One answer to "what is actually wrong", for everything that used to work it out alone.
 *
 * The wizard, the connection bar and every greyed-out control each re-derived this from a slightly
 * different set of facts, so they could disagree — and did, most visibly after a reboot, where the
 * bar said "locked", the wizard stayed shut and the Tune tab simply did nothing.
 *
 * Privilege is read first and the elevation state second, on purpose. Privilege is the measured
 * fact: probePrivilege() writes a prop and reads it back, and both a dropped channel and a channel
 * the launch watcher reconnected behind the app's back go through it. The elevation state only
 * explains *why* privilege is missing, and a cached one can be stale — so it is never allowed to
 * claim the app is unlocked when the probe says otherwise.
 */
import { getElevation } from './adb'
import { getGrants } from './auto-profile'
import { getConnectionMode, getPrivilege } from '../stores/device.svelte'
import type { ElevationState } from '../plugins/shell-exec'
import type { Grants } from '../plugins/auto-profile'
import type { PlainKey } from '../i18n/index.svelte'

/**
 * What stands between the app and working, at most one thing at a time.
 *
 * `degraded` is the state that has been breaking things silently: connected, so every control
 * looks live, but a grant is missing, so the launch watcher dies in the background and nothing
 * ever says so.
 */
export type Blocker =
  | 'ready' | 'needsDevMode' | 'needsPort' | 'needsTrust' | 'degraded' | 'notHeadset'

/**
 * Mapped rather than switched, so a new ElevationState is a type error here instead of a silent
 * fall-through. CONNECTED only ever reaches this table when privilege disagrees with it, which
 * means the connection is not carrying what it claims — Unlock is the fix that has a chance.
 */
const FROM_ELEVATION: Record<ElevationState, Blocker> = {
  DEV_MODE_OFF: 'needsDevMode',
  NO_PORT: 'needsPort',
  PORT_OPEN_UNAUTHORIZED: 'needsTrust',
  AWAITING_USER: 'needsTrust',
  REJECTED_OR_IGNORED: 'needsTrust',
  DROPPED: 'needsTrust',
  CONNECTED: 'needsTrust',
  UNSUPPORTED: 'notHeadset',
}

/** The bar's one-line reason. Each ends in what tapping it does, because tapping it is the fix. */
export const BLOCKER_LINE: Record<Blocker, PlainKey> = {
  ready: 'conn.blocker.ready',
  degraded: 'conn.blocker.degraded',
  needsDevMode: 'conn.blocker.needsDevMode',
  needsPort: 'conn.blocker.needsPort',
  needsTrust: 'conn.blocker.needsTrust',
  notHeadset: 'conn.blocker.notHeadset',
}

/** null until something has actually been asked — an unasked question has no answer to show. */
let elevation = $state<ElevationState | null>(null)
let grants = $state<Grants | null>(null)

const blocker = $derived.by((): Blocker => {
  if (getConnectionMode() !== 'native') return getPrivilege() === 'shell' ? 'ready' : 'notHeadset'
  if (getPrivilege() === 'shell') {
    // secureSettings is deliberately not counted: it is granted and inert on this firmware, and a
    // permanent amber row for something that changes nothing is how a checklist stops being read.
    return grants && !(grants.doze && grants.usageAccess) ? 'degraded' : 'ready'
  }
  // Before the first read the commonest cause is the true one: the port closes at every restart.
  return elevation === null ? 'needsPort' : FROM_ELEVATION[elevation]
})

export function getBlocker(): Blocker { return blocker }

/** The raw state behind the blocker, for the checklist that has to explain each row separately. */
export function getElevationState(): ElevationState | null { return elevation }
export function getGrantState(): Grants | null { return grants }

/** Re-reads both facts. Cheap enough to call after anything that could have changed either. */
export async function refreshSetupState(): Promise<void> {
  const [live, held] = await Promise.all([getElevation(), getGrants()])
  elevation = live.state
  grants = held
}

// Primed at load for the same reason probePrivilege() is: the bar renders before anyone asks it
// anything, and "needsPort" guessed at t=0 must be replaced by a measured answer as soon as possible.
void refreshSetupState()
