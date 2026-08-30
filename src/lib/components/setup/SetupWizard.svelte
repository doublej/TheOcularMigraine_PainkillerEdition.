<script lang="ts">
  import { focusTrap } from '../../actions/focusTrap'
  import { getSetupOpen, openSetup, closeSetup, type SetupStep } from '../../stores/navigation.svelte'
  import { getConnectionMode, getPrivilege, refreshConnectionState } from '../../stores/device.svelte'
  import { probePrivilege, elevate, getElevation } from '../../bridge/adb'
  import { setSetupSeen } from '../../stores/persistence'
  import { t, type PlainKey } from '../../i18n/index.svelte'
  import type { ElevationState } from '../../plugins/shell-exec'
  import Button from '../ui/Button.svelte'
  import CapabilityMatrix from '../ui/CapabilityMatrix.svelte'

  const NAV: { step: SetupStep; label: PlainKey }[] = [
    { step: 1, label: 'setup.nav.works' },
    { step: 2, label: 'setup.nav.unlock' },
    { step: 3, label: 'setup.nav.check' },
    { step: 4, label: 'setup.nav.done' },
  ]

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

  const step = $derived(getSetupOpen())
  const privilege = $derived(getPrivilege())
  const onHeadset = $derived(getConnectionMode() === 'native')

  let checking = $state(false)
  let unlocking = $state(false)
  /** null until something has actually been asked — an unasked question has no answer to show. */
  let elevation = $state<ElevationState | null>(null)

  // Any dismissal counts, so the wizard never nags: it is reopened from the connection bar.
  function dismiss() {
    setSetupSeen(true)
    closeSetup()
  }

  function go(next: SetupStep) {
    openSetup(next)
    // Forward is never blocked on a passing check — a wizard that gates Next strands anyone
    // without a computer to hand. Steps 2 and 3 read state; neither refuses to advance.
    if (next === 2) void readElevation()
    if (next === 3) void check()
  }

  async function readElevation() {
    if (!onHeadset) return
    elevation = (await getElevation()).state
  }

  async function unlock() {
    unlocking = true
    try {
      elevation = (await elevate()).state
    } finally {
      unlocking = false
      refreshConnectionState()
    }
  }

  async function check() {
    checking = true
    await probePrivilege(true)
    refreshConnectionState()
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

      <div class="stepper">
        {#each NAV as item}
          <button
            class="stepper-btn"
            class:active={step === item.step}
            class:past={step > item.step}
            aria-current={step === item.step ? 'step' : undefined}
            onclick={() => go(item.step)}
          >
            {t(item.label)}
          </button>
        {/each}
      </div>

      <div class="body">
        {#if step === 1}
          <h2 id="setup-heading">{t('setup.works.heading')}</h2>
          <p class="lede">{t('setup.works.body')}</p>
          <CapabilityMatrix {privilege} />
        {:else if step === 2}
          <h2 id="setup-heading">{t('setup.unlock.heading')}</h2>
          <p class="lede">{t('setup.unlock.body')}</p>
          <p class="lead">{t('setup.unlock.lead')}</p>
          <ol class="howto">
            {#each HOWTO as line}
              <li>{t(line)}</li>
            {/each}
          </ol>

          <div class="verify" aria-live="polite" aria-busy={unlocking}>
            {#if elevation}
              <p class="state" class:good={elevation === 'CONNECTED'}>{t(STATE_LINE[elevation])}</p>
            {/if}
          </div>

          <Button variant="primary" disabled={unlocking || !onHeadset} onclick={unlock}>
            {unlocking ? t('setup.unlock.working') : t('setup.unlock.button')}
          </Button>

          <p class="caveat">{t('setup.unlock.caveat')}</p>
          <p class="lede">{t('setup.unlock.reboot')}</p>
        {:else if step === 3}
          <h2 id="setup-heading">{t('setup.check.heading')}</h2>
          <p class="lede">{t('setup.check.body')}</p>
          <div class="verify" aria-live="polite" aria-busy={checking}>
            {#if checking}
              <p class="lede">{t('setup.check.checking')}</p>
            {:else}
              <CapabilityMatrix {privilege} />
            {/if}
          </div>
          <p class="lead">{t('setup.check.skip')}</p>
          <Button size="sm" disabled={checking} onclick={check}>{t('setup.check.again')}</Button>
        {:else}
          <h2 id="setup-heading">{t('setup.done.heading')}</h2>
          <p class="lede">{t('setup.done.body')}</p>
          <CapabilityMatrix {privilege} />
        {/if}
      </div>

      <div class="foot">
        {#if step > 1}
          <Button size="sm" variant="ghost" onclick={() => go((step - 1) as SetupStep)}>
            {t('setup.back')}
          </Button>
        {/if}
        {#if step < 4}
          <Button size="sm" variant="primary" onclick={() => go((step + 1) as SetupStep)}>
            {t('setup.next')}
          </Button>
        {:else}
          <Button size="sm" variant="primary" onclick={dismiss}>{t('setup.done')}</Button>
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

  /* A stepper, not the section segmented control: these have an order, and tapping one is a jump. */
  .stepper {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .stepper-btn {
    flex: 1;
    min-height: 40px;
    padding: 6px 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font-size: 12.5px;
    cursor: pointer;
  }

  .stepper-btn.past {
    color: var(--text-secondary);
  }

  .stepper-btn.active {
    border-color: var(--primary);
    color: var(--text);
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

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
</style>
