<script lang="ts">
  import * as adb from '../../bridge/adb'

  let {
    open = $bindable(false),
    title = 'Select App',
    onselect,
    multiple = false,
    selected = $bindable<string[]>([]),
  }: {
    open?: boolean
    title?: string
    onselect?: (pkg: string) => void
    multiple?: boolean
    selected?: string[]
  } = $props()

  let packages = $state<string[]>([])
  let loading = $state(false)
  let filter = $state('')

  const filtered = $derived(
    filter
      ? packages.filter(p => p.toLowerCase().includes(filter.toLowerCase()))
      : packages,
  )

  async function load() {
    loading = true
    packages = await adb.getInstalledPackages()
    loading = false
  }

  function selectPkg(pkg: string) {
    if (multiple) {
      if (selected.includes(pkg)) {
        selected = selected.filter(p => p !== pkg)
      } else {
        selected = [...selected, pkg]
      }
    } else {
      onselect?.(pkg)
      open = false
    }
  }

  function done() {
    open = false
  }

  function close() {
    filter = ''
    open = false
  }

  $effect(() => {
    if (open) load()
  })
</script>

{#if open}
  <div class="overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="modal" role="dialog" aria-label={title} onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h3>{title}</h3>
        <button class="close-btn" onclick={close}>&times;</button>
      </div>
      <input
        type="search"
        class="search"
        placeholder="Filter packages..."
        bind:value={filter}
      />
      <div class="pkg-list">
        {#if loading}
          <p class="status">Loading packages...</p>
        {:else if filtered.length === 0}
          <p class="status">No packages found</p>
        {:else}
          {#each filtered as pkg}
            <button
              class="pkg-item"
              class:selected={selected.includes(pkg)}
              onclick={() => selectPkg(pkg)}
            >
              {#if multiple}
                <span class="checkbox" class:checked={selected.includes(pkg)}></span>
              {/if}
              <span class="pkg-name">{pkg}</span>
            </button>
          {/each}
        {/if}
      </div>
      {#if multiple}
        <div class="modal-footer">
          <button class="done-btn" onclick={done}>
            Done ({selected.length} selected)
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .modal {
    width: 100%;
    max-width: 480px;
    max-height: 80vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .close-btn {
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 22px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .search {
    margin: 12px 16px;
    height: 44px;
    padding: 0 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text);
    outline: none;
  }

  .search:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-glow);
  }

  .search::placeholder {
    color: var(--text-muted);
  }

  .pkg-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 12px 12px;
  }

  .status {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }

  .pkg-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 14px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .pkg-item:hover {
    background: var(--surface-elevated);
  }

  .pkg-item.selected {
    background: var(--primary-glow);
  }

  .pkg-name {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .pkg-item.selected .pkg-name {
    color: var(--primary);
  }

  .checkbox {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-radius: 4px;
    flex-shrink: 0;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .checkbox.checked {
    background: var(--primary);
    border-color: var(--primary);
  }

  .modal-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .done-btn {
    width: 100%;
    height: 44px;
    background: var(--primary);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .done-btn:hover {
    opacity: 0.9;
  }
</style>
