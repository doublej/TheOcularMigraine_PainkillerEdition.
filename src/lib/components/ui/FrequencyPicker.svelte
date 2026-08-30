<script lang="ts">
  import { t } from '../../i18n/index.svelte'

  let {
    value = $bindable(),
    options,
    label = '',
    unset = false,
    extendedMax = 0,
    onchange,
  }: {
    value: number
    /** Rates this headset actually supports — required, so no caller inherits another model's list. */
    options: number[]
    label?: string
    /**
     * A rate above everything Meta documents for this model, which the headset reported anyway.
     * 0 when there is none. Called out rather than blended in: an extended rate is not the same
     * kind of promise as a documented one.
     */
    extendedMax?: number
    /** The headset has no value for this prop — show "headset default" instead of a stale number. */
    unset?: boolean
    onchange?: (value: number) => void
  } = $props()

  const unsupported = $derived(!unset && !options.includes(value))
</script>

<div class="freq-picker">
  <div class="freq-header">
    <span class="freq-label">{label || t('freq.label')}</span>
    {#if unset}
      <span class="freq-unset">{t('common.headsetDefault')}</span>
    {:else}
      <span class="freq-readout">{value}<span class="hz">Hz</span></span>
    {/if}
  </div>
  <div class="freq-options">
    {#each options as hz}
      <button
        class="freq-btn"
        class:active={!unset && value === hz}
        onclick={() => { value = hz; onchange?.(hz) }}
      >
        {hz}<span class="hz">Hz</span>
      </button>
    {/each}
  </div>
  <!-- Never "this headset only runs …": when the model is unrecognised this list is the caller's
       fallback guess, and the app must not assert a capability it never read. -->
  {#if unsupported}
    <p class="freq-warning">
      {t('freq.unsupported', { value, options: options.join(' / ') })}
    </p>
  {/if}
  {#if extendedMax}
    <p class="freq-extended">{t('freq.extended', { hz: extendedMax })}</p>
  {/if}
</div>

<style>
  .freq-extended {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .freq-picker {
    padding: 10px 0;
  }

  .freq-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 10px;
  }

  .freq-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .freq-readout {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
    color: var(--primary);
    flex-shrink: 0;
  }

  .freq-unset {
    font-size: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .freq-options {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .freq-btn {
    flex: 1;
    height: 48px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  .freq-btn:last-child {
    border-right: none;
  }

  .freq-btn:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .freq-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .hz {
    font-size: 11px;
    font-weight: 400;
    opacity: 0.5;
  }

  .freq-warning {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--warning);
  }
</style>
