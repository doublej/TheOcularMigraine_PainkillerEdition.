<script lang="ts">
  import { getConnectionMode, getServerConnected, refreshConnectionState } from '../../stores/device.svelte'
  import { reconnect } from '../../bridge/adb'

  let mode = $derived(getConnectionMode())
  let connected = $derived(getServerConnected())
  let reconnecting = $state(false)

  async function handleReconnect() {
    reconnecting = true
    await reconnect()
    refreshConnectionState()
    reconnecting = false
  }
</script>

{#if mode !== 'native'}
  <button
    class="indicator"
    class:desktop={mode === 'desktop' && connected}
    class:mock={mode === 'mock' || !connected}
    class:disconnected={mode === 'desktop' && !connected}
    disabled={reconnecting || (mode !== 'desktop' || connected)}
    onclick={handleReconnect}
  >
    <span class="dot"></span>
    {#if reconnecting}
      Reconnecting...
    {:else if mode === 'desktop' && !connected}
      Disconnected
    {:else if mode === 'desktop'}
      Desktop
    {:else}
      Mock
    {/if}
  </button>
{/if}

<style>
  .indicator {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--surface);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: default;
    user-select: none;
  }

  .indicator.disconnected {
    cursor: pointer;
    border-color: var(--danger-dim);
  }

  .indicator.disconnected:hover {
    background: var(--surface-hover);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warning);
  }

  .desktop .dot { background: var(--primary); }
  .disconnected .dot { background: var(--danger); }
</style>
