<script lang="ts">
  import { showToast } from '../../stores/toast.svelte'
  import { t } from '../../i18n/index.svelte'

  let {
    checked = $bindable(false),
    label = '',
    description = '',
    disabled = false,
    confirm = '',
    onchange,
  }: {
    checked?: boolean
    label?: string
    description?: string
    disabled?: boolean
    /** Non-empty: every flip needs a second tap, and this says what that flip will do. */
    confirm?: string
    onchange?: (checked: boolean) => void | Promise<void>
  } = $props()

  let armed = $state(false)
  let pending = $state(false)
  let armTimer: ReturnType<typeof setTimeout> | undefined

  function disarm() {
    clearTimeout(armTimer)
    armed = false
  }

  // Arming must not outlive the moment or the view: a stray second tap minutes later, or after
  // the tab is switched away and back, must not walk straight through the confirm.
  $effect(() => disarm)

  // The switch must not claim a state the device never took, so the flip is held open until
  // onchange settles and reverted if it throws.
  async function flip() {
    const previous = checked
    checked = !checked
    if (!onchange) return
    pending = true
    try {
      await onchange(checked)
    } catch (err) {
      checked = previous
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      pending = false
    }
  }

  async function handleTap() {
    if (confirm && !armed) {
      clearTimeout(armTimer)
      armed = true
      armTimer = setTimeout(() => (armed = false), 5000)
      return
    }
    disarm()
    await flip()
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  class="toggle"
  class:disabled={disabled || pending}
  disabled={disabled || pending}
  onclick={handleTap}
  onblur={disarm}
>
  <span class="toggle-text">
    {#if label}<span class="toggle-label">{label}</span>{/if}
    {#if armed}
      <span class="toggle-confirm">{confirm}{t('toggle.confirmSuffix')}</span>
    {:else if description}
      <span class="toggle-desc">{description}</span>
    {/if}
  </span>
  <span class="toggle-switch" class:on={checked}>
    <span class="toggle-thumb"></span>
  </span>
</button>

<style>
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 6px 0;
    background: none;
    border: 0;
    text-align: left;
    cursor: pointer;
  }

  .toggle.disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toggle-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .toggle-desc {
    font-size: 13px;
    color: var(--text-muted);
  }

  .toggle-confirm {
    font-size: 13px;
    color: var(--warning);
  }

  .toggle-switch {
    position: relative;
    width: 52px;
    height: 28px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    transition: all var(--duration) var(--ease-out);
  }

  .toggle-switch.on {
    background: var(--primary);
    border-color: var(--primary);
    box-shadow: var(--glow-primary);
  }

  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    background: var(--text);
    border-radius: 50%;
    transition: transform var(--duration) var(--ease-spring);
  }

  .toggle-switch.on .toggle-thumb {
    transform: translateX(24px);
    background: var(--bg);
  }
</style>
