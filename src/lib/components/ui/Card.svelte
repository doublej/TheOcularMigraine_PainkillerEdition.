<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title = '', children }: { title?: string; children: Snippet } = $props()
</script>

<div class="card">
  {#if title}
    <h3 class="card-title">{title}</h3>
  {/if}
  <div class="card-body">
    {@render children()}
  </div>
</div>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      var(--shadow);
    overflow: hidden;
    position: relative;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
    padding: 16px 18px 0;
  }

  .card-body {
    padding: 14px 18px 18px;
  }
</style>
