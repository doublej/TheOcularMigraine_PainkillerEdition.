<script lang="ts">
  import { t } from '../../i18n/index.svelte'

  let {
    value = $bindable(0),
    min = 0,
    max = 4,
    label = '',
    description = '',
    names,
    unset = false,
    dynamic = $bindable(false),
    showDynamic = true,
    color = 'var(--primary)',
    onchange,
  }: {
    value?: number
    min?: number
    max?: number
    label?: string
    description?: string
    /** Optional segment names, index 0 = min. Falls back to bare integers when omitted. */
    names?: string[]
    /** The headset has no value for this prop — show "headset default" instead of a stale number. */
    unset?: boolean
    dynamic?: boolean
    showDynamic?: boolean
    color?: string
    onchange?: (value: number, dynamic: boolean) => void
  } = $props()

  const levels = $derived(Array.from({ length: max - min + 1 }, (_, i) => i + min))
  const name = $derived(names?.[value - min] ?? '')
</script>

<div class="level-picker">
  <div class="level-header">
    <div class="level-text">
      <span class="level-label">{label}</span>
      {#if description}<span class="level-desc">{description}</span>{/if}
    </div>
    {#if unset}
      <span class="level-unset">{t('common.headsetDefault')}</span>
    {:else}
      <span class="level-readout">
        <span class="level-value" style:color>{name || value}</span>
        <span class="level-scale">
          {name ? t('level.scaleNamed', { value, max }) : t('level.scale', { max })}
        </span>
      </span>
    {/if}
  </div>
  <div class="level-buttons" class:capped={showDynamic && dynamic}>
    {#each levels as level}
      <button
        class="level-btn"
        class:active={!unset && value === level}
        style:--active-color={color}
        aria-label={names ? `${label} ${names[level - min] ?? level} (level ${level})` : undefined}
        onclick={() => { value = level; onchange?.(level, dynamic) }}
      >
        {#if names}
          <span class="level-btn-name">{names[level - min] ?? level}</span>
        {:else}
          {level}
        {/if}
      </button>
    {/each}
  </div>
  {#if showDynamic}
    <label class="dynamic-toggle">
      <input type="checkbox" bind:checked={dynamic} onchange={() => onchange?.(value, dynamic)} />
      <span>{t('level.auto', { what: unset ? t('level.autoUnset') : String(name || value) })}</span>
    </label>
  {/if}
</div>

<style>
  .level-picker {
    padding: 10px 0;
  }

  .level-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 10px;
  }

  .level-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .level-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .level-desc {
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-secondary);
  }

  .level-readout {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-shrink: 0;
  }

  .level-value {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
  }

  .level-scale {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .level-unset {
    font-size: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .level-buttons {
    display: flex;
    /* Five 44px segments need ~225px. In a narrower column the strip wraps into rows of
       full-size buttons rather than shrinking them to 19px — these are the primary controls. */
    flex-wrap: wrap;
    gap: 1px;
    background: var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
    transition: opacity var(--duration) var(--ease-out);
  }

  /* Dynamic on: the strip is a ceiling the runtime moves under, not the running level */
  .level-buttons.capped {
    opacity: 0.55;
  }

  .level-btn {
    /* Grows to share the row, never below a thumb. The 1px flex gap paints the segment
       hairlines, so wrapped rows are separated the same way the segments are. */
    flex: 1 1 44px;
    min-width: 44px;
    height: 44px;
    background: var(--surface-elevated);
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .level-btn:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .level-btn.active {
    background: color-mix(in srgb, var(--active-color) 18%, transparent);
    color: var(--active-color);
    box-shadow: 0 0 12px color-mix(in srgb, var(--active-color) 20%, transparent);
  }

  .level-btn-name {
    display: block;
    padding: 0 2px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dynamic-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .dynamic-toggle input {
    accent-color: var(--primary);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
