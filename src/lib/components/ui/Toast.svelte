<script lang="ts">
  import { getToasts, dismissToast } from '../../stores/toast.svelte'

  const toasts = $derived(getToasts())
</script>

{#if toasts.length > 0}
  <div class="toast-container">
    {#each toasts as toast (toast.id)}
      <!-- Tappable because an error toast never times out: this is its only way off the screen. -->
      <button class="toast toast-{toast.type}" onclick={() => dismissToast(toast.id)}>
        {toast.message}
      </button>
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
    width: 100%;
    min-height: 44px;
    padding: 12px 16px;
    border-radius: var(--radius-pill);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: slideIn 0.2s var(--ease-out);
    pointer-events: auto;
    cursor: pointer;
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
