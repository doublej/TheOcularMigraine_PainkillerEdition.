<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getActiveTab, setActiveTab, type Tab } from '../../stores/navigation.svelte'

  let { title = '', status }: { title?: string; status?: Snippet } = $props()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'tune', label: 'Tune' },
    { id: 'recording', label: 'Record' },
    { id: 'system', label: 'System' },
  ]
</script>

<header class="header">
  <div class="header-top">
    <h1>{title}</h1>
    {#if status}
      <div class="header-status">
        {@render status()}
      </div>
    {/if}
  </div>
  <nav class="header-tabs">
    {#each tabs as tab}
      <button
        class="htab"
        class:active={getActiveTab() === tab.id}
        onclick={() => setActiveTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </nav>
</header>

<style>
  .header {
    flex-shrink: 0;
    padding: 12px 16px 0;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .header-tabs {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .htab {
    flex: 1;
    height: 38px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .htab:last-child {
    border-right: none;
  }

  .htab.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: var(--glow-primary);
  }
</style>
