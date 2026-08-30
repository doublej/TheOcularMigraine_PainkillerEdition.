<script lang="ts">
  import { onMount } from 'svelte'
  import { getConnectionMode, getServerConnected, getPrivilege, refreshConnectionState } from '../../stores/device.svelte'
  import { openSetup } from '../../stores/navigation.svelte'
  import { reconnect } from '../../bridge/adb'
  import { showToast } from '../../stores/toast.svelte'
  import { t } from '../../i18n/index.svelte'

  /** Measured, not assumed: this bar is fixed over the scroll container and wraps on a narrow phone. */
  let { height = $bindable(0) }: { height?: number } = $props()

  // One missed ping is a slow phone; three in a row (~15s) is a bridge worth reporting as gone.
  const MISS_LIMIT = 3

  let mode = $derived(getConnectionMode())
  let connected = $derived(getServerConnected())
  let privilege = $derived(getPrivilege())
  let misses = $state(0)
  /**
   * Health is a privilege question, not a transport one: a sideloaded build reaches the headset
   * and still cannot change it. This bar used to render nothing at all on native, which is exactly
   * why a sideloaded user was never told anything was wrong.
   */
  let healthy = $derived(
    privilege === 'shell' && (mode !== 'desktop' || (connected && misses < MISS_LIMIT)),
  )
  /** Only a working on-headset route has nothing to report. */
  let silent = $derived(mode === 'native' && healthy)
  let reconnecting = $state(false)

  onMount(() => {
    // adb knows it is native synchronously, but the store starts at 'mock' until something asks it.
    refreshConnectionState()
    // On the headset there is no bridge to poll. The privilege probe is what changes this bar,
    // and it reports through the same listener a dropped bridge already uses.
    if (mode === 'native') return
    // adb settles its mode from an async ping, so the store's first read can still say 'mock' on a live bridge,
    // and the bridge can be started after the app is open — so keep probing instead of stranding the session.
    probeBridge()
    const poll = setInterval(probeBridge, 5000)
    return () => clearInterval(poll)
  })

  async function probeBridge() {
    const res = await fetch('/api/ping', { signal: AbortSignal.timeout(800) }).catch(() => null)
    misses = res?.ok ? 0 : misses + 1
    // reconnect() drops the session to 'mock' on a single 800ms miss, and mock answers reads with
    // fixtures and writes with a fake success — including mid-sweep, where those fakes are counted
    // as successes. So it only ever runs to bring a bridge back, never to lose one: a bridge that
    // stops answering is reported by this bar and proved dead by the next real request, which throws.
    if (res?.ok && !healthy) {
      await reconnect()
      refreshConnectionState()
    }
  }

  async function handleReconnect() {
    reconnecting = true
    await probeBridge()
    reconnecting = false
    if (healthy) showToast(t('conn.toast.ok'), 'success')
    else showToast(t('conn.toast.down'), 'error')
  }

  /**
   * On the headset the fix is never a retry — the port has to be opened from a computer first — so
   * the tap opens the wizard at the step that explains it. The bridge is a developer route and is
   * the only place a bare retry means anything.
   */
  function handleTap() {
    if (mode === 'desktop') void handleReconnect()
    else if (mode === 'native') openSetup(2)
    else openSetup(1)
  }
</script>

{#if !silent}
  <button
    class="indicator"
    class:healthy
    class:offline={!healthy && mode === 'desktop'}
    class:demo={!healthy && mode !== 'desktop'}
    disabled={reconnecting || healthy}
    onclick={handleTap}
    bind:offsetHeight={height}
  >
    <span class="dot"></span>
    {#if reconnecting}
      {t('conn.reconnecting')}
    {:else if healthy}
      {t('conn.computer.ok')}
    {:else if mode === 'desktop'}
      {t('conn.computer.down')}
    {:else if mode === 'native'}
      {privilege === 'none' ? t('conn.headset.dropped') : t('conn.headset.locked')}
    {:else}
      {t('conn.offline')}
    {/if}
  </button>
{/if}

<style>
  .indicator {
    position: fixed;
    left: 12px;
    bottom: calc(var(--tab-height) + 12px);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--surface);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: default;
    user-select: none;
  }

  /* Not reaching a headset is the most consequential state in the app: a full-width bar, not a corner pill. */
  .indicator.offline,
  .indicator.demo {
    right: 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }

  .indicator.offline { border-color: var(--danger-dim); }
  .indicator.demo { border-color: var(--warning); }

  .indicator:not(:disabled):hover {
    background: var(--surface-hover);
  }

  .indicator:disabled {
    cursor: default;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--warning);
  }

  .healthy .dot { background: var(--primary); }
  .offline .dot { background: var(--danger); }
  .demo .dot { background: var(--warning); }
</style>
