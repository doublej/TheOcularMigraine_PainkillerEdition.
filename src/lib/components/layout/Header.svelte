<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title = '', status }: { title?: string; status?: Snippet } = $props()
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
</header>

<style>
  .header {
    flex-shrink: 0;
    /* viewport-fit=cover is set in index.html, so the title must clear a notch on its own. */
    padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 0;
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
</style>
