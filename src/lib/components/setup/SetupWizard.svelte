<script lang="ts">
  import { focusTrap } from '../../actions/focusTrap'
  import { getSetupOpen, openSetup, closeSetup, type SetupStep } from '../../stores/navigation.svelte'
  import { getConnectionMode, getPrivilege, refreshConnectionState } from '../../stores/device.svelte'
  import { probePrivilege, elevate, getElevation } from '../../bridge/adb'
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

  const step = $derived(getSetupOpen())
  const privilege = $derived(getPrivilege())
  const onHeadset = $derived(getConnectionMode() === 'native')
  const can = $derived(abilitiesFor(privilege))
  const everythingWorks = $derived(Object.values(can).every(Boolean))

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
    if (next === 1) void readElevation()
    if (next === 2) void check()
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
        {:else}
          <h2 id="setup-heading">{t('setup.done.heading')}</h2>
          <div class="verify" aria-live="polite" aria-busy={checking}>
            {#if checking}
              <p class="lede">{t('setup.check.checking')}</p>
            {:else if everythingWorks}
              <p class="good-line">{t('setup.done.allWorks')}</p>
            {:else}
              <!-- Only what is switched off. A list of ticks for things that already work is the
                   noise that made this wizard unreadable. -->
              <p class="lead">{t('setup.done.someOff')}</p>
              <CapabilityMatrix {privilege} blockedOnly />
            {/if}
          </div>
          <p class="lede">{t('setup.done.body')}</p>
          <Button size="sm" disabled={checking} onclick={check}>{t('setup.check.again')}</Button>
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

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
</style>
