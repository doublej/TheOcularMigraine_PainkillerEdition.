<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    variant = 'default',
    size = 'md',
    disabled = false,
    onclick,
    children,
  }: {
    variant?: 'default' | 'primary' | 'danger' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    onclick?: () => void
    children: Snippet
  } = $props()
</script>

<button
  class="btn {variant} {size}"
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-sans);
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: all var(--duration) var(--ease-out);
    white-space: nowrap;
  }

  .btn:active {
    transform: scale(0.97);
  }

  .btn:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .sm { height: 40px; padding: 0 14px; font-size: 13px; }
  .md { height: 48px; padding: 0 20px; font-size: 15px; }
  .lg { height: 56px; padding: 0 28px; font-size: 17px; }

  .default {
    background: var(--surface-elevated);
    color: var(--text);
  }
  .default:hover { background: var(--surface-hover); }

  .primary {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--bg);
    font-weight: 600;
  }
  .primary:hover { background: var(--primary-dim); border-color: var(--primary-dim); }

  .danger {
    background: transparent;
    border-color: var(--danger-dim);
    color: var(--danger);
  }
  .danger:hover { background: rgba(250, 56, 62, 0.08); }

  .ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-secondary);
  }
  .ghost:hover { color: var(--text); background: var(--surface-elevated); }
</style>
