<script lang="ts">
  import { untrack } from 'svelte'
  import * as adb from '../../bridge/adb'
  import type { NativeApp } from '../../plugins/shell-exec'
  import { focusTrap } from '../../actions/focusTrap'
  import { t } from '../../i18n/index.svelte'

  let {
    open = $bindable(false),
    title = 'Select App',
    onselect,
    ondone,
    multiple = false,
    current = '',
    selected = $bindable<string[]>([]),
  }: {
    open?: boolean
    title?: string
    onselect?: (pkg: string) => void
    ondone?: (selected: string[]) => void
    multiple?: boolean
    current?: string
    selected?: string[]
  } = $props()

  let packages = $state<NativeApp[]>([])
  let loading = $state(false)
  let loadError = $state('')
  let filter = $state('')
  /** Ticks write straight through to the parent's list, so cancelling has to put the old one back. */
  let snapshot: string[] = []

  const query = $derived(normalizeSearch(filter))
  // Both halves are searched: someone typing "beat saber" and someone typing the id both find it.
  const filtered = $derived(
    query
      ? packages.filter(a => normalizeSearch(a.label + a.packageName).includes(query))
      : packages,
  )

  /** Ids carry no spaces or dots to type: 'beat saber' should still find com.beatgames.beatsaber. */
  function normalizeSearch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  async function load() {
    loading = true
    loadError = ''
    try {
      // PackageManager on the headset gives the real label and icon; off it there is only the id,
      // and getInstalledApps() falls the label back to that rather than inventing a prettier one.
      packages = await adb.getInstalledApps()
      // The mock table answers this read with six invented ids. Listing them as installed is how a
      // dead bridge builds an allow list against apps no headset has — a fixture is not a library.
      if (adb.isFixtureRead()) {
        packages = []
        loadError = 'no headset attached, so nothing was read from one'
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function retryLoad() {
    await adb.reconnect()
    await load()
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
    ondone?.(selected)
    open = false
  }

  /** The only cancel path: the X and the backdrop both discard the ticks made in here. */
  function close() {
    if (multiple) selected = snapshot
    open = false
  }

  $effect(() => {
    if (!open) return
    filter = ''
    snapshot = untrack(() => [...selected])
    load()
  })
</script>

{#if open}
  <div class="overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      use:focusTrap={close}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="modal-header">
        <h3>{title}</h3>
        <button
          class="close-btn"
          class:text={multiple}
          aria-label={multiple ? 'Cancel' : 'Close'}
          onclick={close}
        >
          {#if multiple}Cancel{:else}&times;{/if}
        </button>
      </div>
      <input
        type="search"
        class="search"
        placeholder="Search apps..."
        bind:value={filter}
      />
      <div class="pkg-list">
        {#if loading}
          <p class="status">{t('apps.finding')}</p>
        {:else if loadError}
          <p class="status error">Couldn't read the app list — {loadError}</p>
          <button class="retry-btn" onclick={retryLoad}>{t('common.retry')}</button>
        {:else if packages.length === 0}
          {#if adb.getConnectionMode() === 'mock' || !adb.isServerConnected()}
            <p class="status error">Couldn't read the app list — check the headset connection</p>
            <button class="retry-btn" onclick={retryLoad}>{t('common.retry')}</button>
          {:else}
            <p class="status">{t('apps.none')}</p>
          {/if}
        {:else if filtered.length === 0}
          <p class="status">{t('apps.noMatch', { filter })}</p>
        {:else}
          {#each filtered as app (app.packageName)}
            <button
              class="pkg-item"
              class:selected={multiple ? selected.includes(app.packageName) : app.packageName === current}
              onclick={() => selectPkg(app.packageName)}
            >
              {#if multiple}
                <span class="checkbox" class:checked={selected.includes(app.packageName)}></span>
              {/if}
              {#if app.icon}
                <img class="app-icon" src={app.icon} alt="" width="28" height="28" />
              {/if}
              <span class="pkg-text">
                <span class="app-name">{app.label}</span>
                <span class="pkg-id">{app.packageName}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
      {#if multiple}
        <div class="modal-footer">
          <p class="footer-note">Saved to this list only — apply it from Access Control to change the headset.</p>
          <button class="done-btn" onclick={done}>
            Save {selected.length} app{selected.length === 1 ? '' : 's'}
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
    padding: 10px 12px 10px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .close-btn {
    min-width: 44px;
    height: 44px;
    padding: 0 10px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .app-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .close-btn.text {
    font-size: 14px;
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
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .status {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }

  .status.error {
    color: var(--danger);
    padding-bottom: 12px;
    word-break: break-word;
  }

  .retry-btn {
    align-self: center;
    height: 44px;
    padding: 0 24px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--surface-hover);
  }

  .pkg-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
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

  .pkg-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .app-name {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    word-break: break-all;
  }

  .pkg-id {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    word-break: break-all;
  }

  .pkg-item.selected .app-name {
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

  .footer-note {
    margin-bottom: 8px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
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
