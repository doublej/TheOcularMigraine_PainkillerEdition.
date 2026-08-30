<script lang="ts">
  import { onMount } from 'svelte'
  import { getConnectionMode, getServerConnected, refreshConnectionState } from '../../stores/device.svelte'
  import { reconnect } from '../../bridge/adb'
  import { showToast } from '../../stores/toast.svelte'

  /** Measured, not assumed: this bar is fixed over the scroll container and wraps on a narrow phone. */
  let { height = $bindable(0) }: { height?: number } = $props()

  // One missed ping is a slow phone; three in a row (~15s) is a bridge worth reporting as gone.
  const MISS_LIMIT = 3

  let mode = $derived(getConnectionMode())
  let connected = $derived(getServerConnected())
  let misses = $state(0)
  /** Only a live desktop bridge reaches the headset — in mock mode every write is discarded. */
  let healthy = $derived(mode === 'desktop' && connected && misses < MISS_LIMIT)
  let reconnecting = $state(false)

  onMount(() => {
    // adb knows it is native synchronously, but the store starts at 'mock' until something asks it.
    refreshConnectionState()
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
    if (healthy) showToast('Bridge connected', 'success')
    else showToast('Still offline — nothing is reaching a headset', 'error')
  }
</script>

{#if mode !== 'native'}
  <button
    class="indicator"
    class:healthy
    class:offline={!healthy && mode === 'desktop'}
    class:demo={!healthy && mode !== 'desktop'}
    disabled={reconnecting || healthy}
    onclick={handleReconnect}
    bind:offsetHeight={height}
  >
    <span class="dot"></span>
    {#if reconnecting}
      Reconnecting...
    {:else if healthy}
      Connected via PC
    {:else if mode === 'desktop'}
      Bridge offline — nothing reaches the headset. Tap to retry.
    {:else}
      Demo — no headset. Tap to retry.
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
