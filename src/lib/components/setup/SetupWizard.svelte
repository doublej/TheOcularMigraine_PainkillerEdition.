<script lang="ts">
  import { focusTrap } from '../../actions/focusTrap'
  import { getSetupOpen, openSetup, closeSetup, type SetupStep } from '../../stores/navigation.svelte'
  import { getConnectionMode, getPrivilege, refreshConnectionState } from '../../stores/device.svelte'
  import { probePrivilege, elevate, isPortPersisted, openAndroidSettings, reconnectElevation } from '../../bridge/adb'
  import { getBlocker, getElevationState, getGrantState, refreshSetupState } from '../../bridge/setup-state.svelte'
  import { grantUsageAccess, repairGrants } from '../../bridge/auto-profile'
  import { abilitiesFor } from '../../bridge/capabilities'
  import { setSetupSeen } from '../../stores/persistence'
  import { t, type PlainKey } from '../../i18n/index.svelte'
  import type { ElevationState } from '../../plugins/shell-exec'
  import Button from '../ui/Button.svelte'
  import CapabilityMatrix from '../ui/CapabilityMatrix.svelte'

  const HOWTO: PlainKey[] = ['setup.unlock.step1', 'setup.unlock.step2', 'setup.unlock.step3']

  // Mapped rather than built by template literal, so every key stays checked at compile time.
  const STATE_LINE: Record<ElevationState, PlainKey> = {
    DEV_MODE_OFF: 'setup.state.DEV_MODE_OFF',
    NO_PORT: 'setup.state.NO_PORT',
    PORT_OPEN_UNAUTHORIZED: 'setup.state.PORT_OPEN_UNAUTHORIZED',
    AWAITING_USER: 'setup.state.AWAITING_USER',
    REJECTED_OR_IGNORED: 'setup.state.REJECTED_OR_IGNORED',
    CONNECTED: 'setup.state.CONNECTED',
    DROPPED: 'setup.state.DROPPED',
    UNSUPPORTED: 'setup.state.UNSUPPORTED',
  }

  /** Everything past a ConnectException: adbd answered, so the port itself is open. */
  const PORT_ANSWERED: ElevationState[] = [
    'PORT_OPEN_UNAUTHORIZED', 'AWAITING_USER', 'REJECTED_OR_IGNORED', 'CONNECTED', 'DROPPED',
  ]

  /** Often enough to feel instant when the port opens, rarely enough to be free while it does not. */
  const POLL_MS = 2000
  /** Past this nobody is coming back with a computer, and a timer nobody watches is a battery leak. */
  const POLL_LIMIT_MS = 120_000

  const step = $derived(getSetupOpen())
  const privilege = $derived(getPrivilege())
  const onHeadset = $derived(getConnectionMode() === 'native')
  const can = $derived(abilitiesFor(privilege))
  const everythingWorks = $derived(Object.values(can).every(Boolean))

  const blocker = $derived(getBlocker())
  const elevation = $derived(getElevationState())
  const grants = $derived(getGrantState())
  const unlocked = $derived(privilege === 'shell')

  let checking = $state(false)
  let unlocking = $state(false)
  /** Which requirement's fix is running, so only that row shows it. '' when none is. */
  let fixing = $state('')
  let watching = $state(false)
  let gaveUp = $state(false)
  /** Whether the headset reopens the port itself after a restart. null until the prop has been read. */
  let persisted = $state<boolean | null>(null)

  /**
   * One row per real requirement, each read from something measured and each with the one action
   * that fixes it. CapabilityMatrix answers "what do I get"; this answers "why do I not have it",
   * which is the only question someone stuck in front of a greyed-out Tune tab is actually asking.
   */
  type Requirement = {
    id: string
    label: PlainKey
    how: PlainKey
    ok: boolean
    fix: { label: PlainKey; ready: boolean; run: () => Promise<unknown> } | null
  }

  const requirements = $derived<Requirement[]>([
    {
      id: 'devMode',
      label: 'setup.req.devMode',
      how: 'setup.req.devMode.how',
      ok: elevation !== null && elevation !== 'DEV_MODE_OFF',
      fix: { label: 'setup.unlock.settings', ready: true, run: openAndroidSettings },
    },
    {
      id: 'port',
      // No button: only a computer can open it, and the wizard is already watching for it.
      label: 'setup.req.port',
      how: 'setup.req.port.how',
      ok: unlocked || (elevation !== null && PORT_ANSWERED.includes(elevation)),
      fix: null,
    },
    {
      id: 'trust',
      label: 'setup.req.trust',
      how: 'setup.req.trust.how',
      ok: unlocked,
      fix: { label: 'setup.req.fix.unlock', ready: true, run: unlock },
    },
    {
      id: 'background',
      label: 'setup.req.background',
      how: 'setup.req.background.how',
      ok: grants?.doze === true,
      fix: { label: 'setup.req.fix.grant', ready: unlocked, run: repairGrants },
    },
    {
      id: 'launches',
      label: 'setup.req.launches',
      how: 'setup.req.launches.how',
      ok: grants?.usageAccess === true,
      fix: { label: 'setup.req.fix.grant', ready: unlocked, run: grantUsageAccess },
    },
  ])

  /**
   * Watches for the port while step 1 is open, so the trip back to the headset is the last trip.
   *
   * The old flow asked for a walk each way: run the command on the computer, put the headset back
   * on, find the wizard, tap Unlock. reconnectSilently() prompts nobody, so it is safe to ask on a
   * timer — and a key the headset already trusts gets straight in. Only the port is being waited
   * for: the moment it answers with anything else, the blocker moves on and this stops.
   *
   * It depends on `step` and `onHeadset` alone. Reading the blocker inside the callback keeps it
   * out of the effect's dependencies, which is what stops each refresh from restarting the clock.
   */
  $effect(() => {
    if (step !== 1 || !onHeadset) return
    const deadline = Date.now() + POLL_LIMIT_MS
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      if (getBlocker() !== 'needsPort') { watching = false; return }
      if (Date.now() > deadline) { watching = false; gaveUp = true; return }
      watching = true
      busy = true
      try {
        await reconnectElevation()
        refreshConnectionState()
        await refreshSetupState()
      } finally {
        busy = false
      }
    }, POLL_MS)
    return () => { clearInterval(timer); watching = false }
  })

  // Any dismissal counts while nothing is blocked. When something is, App reopens it once on the
  // next launch — see the auto-open rule there.
  function dismiss() {
    setSetupSeen(true)
    closeSetup()
  }

  function go(next: SetupStep) {
    openSetup(next)
    void readState()
  }

  async function readState() {
    if (!onHeadset) return
    await refreshSetupState()
    persisted = await isPortPersisted()
  }

  async function unlock() {
    unlocking = true
    gaveUp = false
    try {
      await elevate()
    } finally {
      unlocking = false
      refreshConnectionState()
      // elevate() has already tried to write the port prop, so this reads the outcome.
      await readState()
    }
  }

  /**
   * Runs one row's fix and then re-reads every row.
   *
   * A refusal is swallowed on purpose: the rows are read from the framework rather than from what
   * was asked for, so a grant the headset would not give shows up as still missing — which is both
   * the truth and the same thing the row already said.
   */
  async function runFix(row: Requirement) {
    if (!row.fix) return
    fixing = row.id
    try {
      await row.fix.run().catch(() => {})
    } finally {
      fixing = ''
      refreshConnectionState()
      await refreshSetupState()
    }
  }

  async function checkNow() {
    checking = true
    await probePrivilege(true)
    refreshConnectionState()
    await refreshSetupState()
    checking = false
  }
</script>

{#if step !== null}
  <div class="overlay" onclick={dismiss} role="presentation">
    <!-- The dialog's own click handler only stops the backdrop's; Escape and focus are focusTrap's. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-heading"
      tabindex="-1"
      use:focusTrap={dismiss}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="bar">
        <span class="counter">{t('setup.step', { n: step })}</span>
        <button class="close" onclick={dismiss}>{t('setup.close')}</button>
      </div>

      <div class="body">
        {#if step === 1}
          <h2 id="setup-heading">{t('setup.unlock.heading')}</h2>
          <p class="lede">{t('setup.unlock.body')}</p>
          <p class="lead">{t('setup.unlock.lead')}</p>
          <ol class="howto">
            {#each HOWTO as line}
              <li>{t(line)}</li>
            {/each}
          </ol>

          <div class="verify" aria-live="polite" aria-busy={unlocking || watching}>
            {#if elevation}
              <p class="state" class:good={elevation === 'CONNECTED'}>{t(STATE_LINE[elevation])}</p>
            {/if}
            {#if watching}
              <p class="lede">{t('setup.unlock.watching')}</p>
            {:else if gaveUp}
              <p class="lede">{t('setup.unlock.gaveUp')}</p>
            {/if}
          </div>

          <Button variant="primary" disabled={unlocking || !onHeadset} onclick={unlock}>
            {unlocking ? t('setup.unlock.working') : t('setup.unlock.button')}
          </Button>

          <!-- Developer mode lives in the headset's own settings, and the notes are what makes
               that trip survivable: the settings window opens behind this one otherwise. -->
          <Button size="sm" disabled={!onHeadset} onclick={() => void openAndroidSettings()}>
            {t('setup.unlock.settings')}
          </Button>
          <p class="lede">{t('setup.unlock.windows')}</p>
          <p class="lede">{t('setup.unlock.notification')}</p>

          <p class="caveat">{t('setup.unlock.caveat')}</p>
          {#if unlocked && persisted !== null}
            <p class="lede">{t(persisted ? 'setup.persist.on' : 'setup.persist.off')}</p>
          {:else}
            <p class="lede">{t('setup.unlock.reboot')}</p>
          {/if}
        {:else}
          <h2 id="setup-heading">{t('setup.done.heading')}</h2>
          <div class="verify" aria-live="polite" aria-busy={checking}>
            {#if checking}
              <p class="lede">{t('setup.check.checking')}</p>
            {:else if blocker === 'ready' && everythingWorks}
              <p class="good-line">{t('setup.done.allWorks')}</p>
            {/if}
          </div>

          <p class="lead">{t('setup.req.heading')}</p>
          <ul class="reqs">
            {#each requirements as row (row.id)}
              <li class="req" class:no={!row.ok}>
                <span class="mark" aria-hidden="true">{row.ok ? '✓' : '✕'}</span>
                <span class="req-body">
                  <span class="label">{t(row.label)}</span>
                  <span class="verdict">{row.ok ? t('setup.req.ok') : t('setup.req.missing')}</span>
                  {#if !row.ok}
                    <span class="why">{t(row.how)}</span>
                    {#if row.fix}
                      {#if row.fix.ready}
                        <span class="act">
                          <Button size="sm" disabled={fixing !== '' || unlocking} onclick={() => runFix(row)}>
                            {fixing === row.id ? t('setup.req.working') : t(row.fix.label)}
                          </Button>
                        </span>
                      {:else}
                        <span class="why">{t('setup.req.unlockFirst')}</span>
                      {/if}
                    {/if}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>

          {#if !everythingWorks}
            <!-- Only what is switched off. A list of ticks for things that already work is the
                 noise that made this wizard unreadable. -->
            <p class="lead">{t('setup.done.someOff')}</p>
            <CapabilityMatrix {privilege} blockedOnly />
          {/if}

          <p class="lede">{t('setup.done.body')}</p>
          <Button size="sm" disabled={checking} onclick={checkNow}>{t('setup.check.again')}</Button>
        {/if}
      </div>

      <div class="foot">
        {#if step === 2}
          <Button size="sm" variant="ghost" onclick={() => go(1)}>{t('setup.back')}</Button>
          <Button size="sm" variant="primary" onclick={dismiss}>{t('setup.done')}</Button>
        {:else}
          <Button size="sm" variant="primary" onclick={() => go(2)}>{t('setup.next')}</Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Above the connection bar (200) and the TabBar (100), below AppPicker (1000) and Toast (10000). */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 900;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .sheet {
    width: 100%;
    max-width: 480px;
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 8px 18px;
    border-bottom: 1px solid var(--border);
  }

  .counter {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .close {
    min-height: 44px;
    padding: 0 12px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .lede,
  .lead,
  .caveat {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .lead {
    color: var(--text);
  }

  .caveat {
    padding: 10px 12px;
    border: 1px solid var(--warning);
    border-radius: var(--radius-sm);
  }

  .good-line {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--primary);
    border-radius: var(--radius-sm);
    font-size: 14px;
    color: var(--text);
  }

  .state {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--warning);
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text);
  }

  .state.good {
    border-color: var(--primary);
  }

  .howto {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .reqs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .req {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .req.no {
    border-color: var(--warning);
  }

  .mark {
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 1.3;
    color: var(--primary);
  }

  .req.no .mark {
    color: var(--warning);
  }

  .req-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .label {
    font-size: 14px;
    color: var(--text);
  }

  /* Carries the state for a screen reader, which cannot read the tick, and is hidden by eye. */
  .verdict {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .why {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .act {
    display: flex;
    margin-top: 2px;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
</style>
