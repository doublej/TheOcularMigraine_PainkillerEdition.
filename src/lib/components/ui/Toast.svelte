<script lang="ts">
  import { getToasts } from '../../stores/toast.svelte'

  const toasts = $derived(getToasts())
</script>

{#if toasts.length > 0}
  <div class="toast-container">
    {#each toasts as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        {toast.message}
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    top: 16px;
    left: 16px;
    right: 16px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    padding: 12px 16px;
    border-radius: var(--radius-pill);
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: slideIn 0.2s var(--ease-out);
  }

  .toast-success {
    background: rgba(49, 162, 76, 0.15);
    border: 1px solid rgba(49, 162, 76, 0.3);
    color: var(--success);
  }

  .toast-error {
    background: rgba(250, 56, 62, 0.15);
    border: 1px solid rgba(250, 56, 62, 0.3);
    color: var(--danger);
  }

  .toast-info {
    background: rgba(212, 218, 230, 0.1);
    border: 1px solid var(--border);
    color: var(--text);
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
</style>
