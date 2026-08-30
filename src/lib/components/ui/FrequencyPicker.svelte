<script lang="ts">
  let {
    value = $bindable(90),
    options = [60, 72, 90, 120],
    label = 'Refresh Rate',
    onchange,
  }: {
    value?: number
    options?: number[]
    label?: string
    onchange?: (value: number) => void
  } = $props()
</script>

<div class="freq-picker">
  <span class="freq-label">{label}</span>
  <div class="freq-options">
    {#each options as hz}
      <button
        class="freq-btn"
        class:active={value === hz}
        onclick={() => { value = hz; onchange?.(hz) }}
      >
        {hz}<span class="hz">Hz</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .freq-picker {
    padding: 10px 0;
  }

  .freq-label {
    display: block;
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 10px;
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
</style>
