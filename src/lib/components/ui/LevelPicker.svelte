<script lang="ts">
  let {
    value = $bindable(0),
    min = 0,
    max = 5,
    label = '',
    dynamic = $bindable(false),
    showDynamic = true,
    color = 'var(--primary)',
    onchange,
  }: {
    value?: number
    min?: number
    max?: number
    label?: string
    dynamic?: boolean
    showDynamic?: boolean
    color?: string
    onchange?: (value: number, dynamic: boolean) => void
  } = $props()

  const levels = $derived(Array.from({ length: max - min + 1 }, (_, i) => i + min))
</script>

<div class="level-picker">
  <div class="level-header">
    <span class="level-label">{label}</span>
    <span class="level-value" style:color>{value}</span>
  </div>
  <div class="level-buttons">
    {#each levels as level}
      <button
        class="level-btn"
        class:active={value === level}
        style:--active-color={color}
        onclick={() => { value = level; onchange?.(level, dynamic) }}
      >
        {level}
      </button>
    {/each}
  </div>
  {#if showDynamic}
    <label class="dynamic-toggle">
      <input type="checkbox" bind:checked={dynamic} onchange={() => onchange?.(value, dynamic)} />
      <span>Dynamic</span>
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
    align-items: center;
    margin-bottom: 10px;
  }

  .level-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .level-value {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
  }

  .level-buttons {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .level-btn {
    flex: 1;
    height: 44px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .level-btn:last-child {
    border-right: none;
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

  .dynamic-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .dynamic-toggle input {
    accent-color: var(--primary);
    width: 16px;
    height: 16px;
  }
</style>
