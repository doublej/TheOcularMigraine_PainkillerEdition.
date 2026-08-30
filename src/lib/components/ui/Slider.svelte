<script lang="ts">
  import { t } from '../../i18n/index.svelte'

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    label = '',
    unit = '',
    color = 'var(--primary)',
    unset = false,
  }: {
    value?: number
    min?: number
    max?: number
    step?: number
    label?: string
    unit?: string
    color?: string
    /**
     * The headset has no value for this prop, so the number beside the label is this component's
     * own default rather than anything that was read back. LevelPicker and FrequencyPicker have
     * said so since they were written; a slider silently showing 0% was the same lie without the
     * tell — and 0% is exactly what an unset FOV crop looks like.
     */
    unset?: boolean
  } = $props()

  // A device readback or a saved preset can hand us a number that is out of range or off the
  // step grid (a headset reporting 1832 on a 512/32 grid). The browser snaps the thumb but not
  // the bound value, so the readout and the thumb drift apart — snap once here instead.
  const decimals = $derived(String(step).split('.')[1]?.length ?? 0)
  const safe = $derived(snapToRange(value))
  const pct = $derived(((safe - min) / (max - min)) * 100)

  function snapToRange(n: number): number {
    if (!Number.isFinite(n)) return min
    const snapped = min + Math.round((n - min) / step) * step
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals))
  }

  // The clamp has to reach the binding, not just the pixels: a fovCrop of 80 saved by the old
  // max={100} slider under the same localStorage key renders "40%" but would still put 0.8 on
  // the wire. snapToRange is idempotent, so this settles in one pass and never loops.
  $effect(() => {
    if (value !== safe) value = safe
  })

  function decrement() {
    value = snapToRange(safe - step)
  }

  function increment() {
    value = snapToRange(safe + step)
  }
</script>

<div class="slider-wrap">
  <div class="slider-header">
    <span class="slider-label">{label}</span>
    {#if unset}
      <span class="slider-unset">{t('common.headsetDefault')}</span>
    {:else}
      <span class="slider-value" style:color>
        {safe}{unit}
      </span>
    {/if}
  </div>
  <div class="slider-row">
    <button class="stepper" onclick={decrement} disabled={safe <= min} aria-label="Decrease {label}">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h8"/></svg>
    </button>
    <div class="slider-track" class:unset style:--pct="{pct}%" style:--color={color}>
      <input
        type="range"
        {min}
        {max}
        {step}
        value={safe}
        oninput={(e) => (value = e.currentTarget.valueAsNumber)}
        aria-label={label}
        aria-valuetext={unset ? t('common.headsetDefault') : `${safe}${unit}`}
      />
    </div>
    <button class="stepper" onclick={increment} disabled={safe >= max} aria-label="Increase {label}">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h8M8 4v8"/></svg>
    </button>
  </div>
</div>

<style>
  .slider-unset {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Dimmed rather than disabled: touching it is how you leave the headset default behind. */
  .slider-track.unset {
    opacity: 0.45;
  }

  .slider-wrap {
    padding: 10px 0;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .slider-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .slider-value {
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 700;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .stepper {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .stepper:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .stepper:active {
    transform: scale(0.93);
  }

  .stepper:disabled {
    opacity: 0.25;
    pointer-events: none;
  }

  .stepper svg {
    width: 14px;
    height: 14px;
  }

  .slider-track {
    flex: 1;
    position: relative;
    height: 44px;
  }

  /* The visible 6px track is painted here so the input can be a transparent 44px drag band
     on top of it — a thumb-wide target without a thumb-wide bar. */
  .slider-track::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 6px;
    margin-top: -3px;
    border-radius: 3px;
    background: linear-gradient(to right, var(--color) 0%, var(--color) var(--pct), var(--border) var(--pct), var(--border) 100%);
  }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    display: block;
    width: 100%;
    height: 44px;
    padding: 19px 0;
    background: transparent;
    outline: none;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 6px;
    background: transparent;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -8px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 4px var(--bg), 0 2px 8px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    transition: transform var(--duration-fast) var(--ease-spring);
  }

  input[type="range"]::-webkit-slider-thumb:active {
    transform: scale(1.15);
  }
</style>
