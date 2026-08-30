<script lang="ts">
  import { onMount } from 'svelte'
  import Header from './lib/components/layout/Header.svelte'
  import Toast from './lib/components/ui/Toast.svelte'
  import ConnectionIndicator from './lib/components/ui/ConnectionIndicator.svelte'
  import { getActiveTab } from './lib/stores/navigation.svelte'
  import { getDevice, refreshConnectionState } from './lib/stores/device.svelte'
  import Tune from './views/Tune.svelte'
  import Recording from './views/Recording.svelte'
  import System from './views/System.svelte'

  const device = $derived(getDevice())

  onMount(() => {
    refreshConnectionState()
  })
</script>

<Toast />
<ConnectionIndicator />

<div class="app">
  <Header title="Ocular Migraine">
    {#snippet status()}
      <span class="status-chip" class:low={device.battery < 20} class:charging={device.charging}>
        {device.battery}%
      </span>
    {/snippet}
  </Header>
  <main class="content">
    {#if getActiveTab() === 'tune'}
      <Tune />
    {:else if getActiveTab() === 'recording'}
      <Recording />
    {:else if getActiveTab() === 'system'}
      <System />
    {/if}
  </main>
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 16px;
  }

  .status-chip {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--success);
  }

  .status-chip.low {
    color: var(--danger);
  }

  .status-chip.charging {
    color: var(--warning);
  }
</style>
