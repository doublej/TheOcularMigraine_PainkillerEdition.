<script lang="ts">
  import Header from './lib/components/layout/Header.svelte'
  import TabBar from './lib/components/layout/TabBar.svelte'
  import Toast from './lib/components/ui/Toast.svelte'
  import ConnectionIndicator from './lib/components/ui/ConnectionIndicator.svelte'
  import { getActiveTab } from './lib/stores/navigation.svelte'
  import { getDevice } from './lib/stores/device.svelte'
  import Tune from './views/Tune.svelte'
  import Recording from './views/Recording.svelte'
  import System from './views/System.svelte'

  const device = $derived(getDevice())
  let contentEl: HTMLElement | undefined = $state()

  // The offline bar is fixed over this container and wraps to two lines on a narrow phone, so the
  // content clears what it actually measures (plus its 12px offset and 12px of air), never a guess.
  let bridgeBarHeight = $state(0)
  const contentPadding = $derived(
    bridgeBarHeight ? `calc(var(--tab-height) + ${bridgeBarHeight + 24}px)` : 'var(--tab-height)',
  )

  // All three views share one scroll container, so a tab swap must not land the user mid-page.
  $effect(() => {
    getActiveTab()
    contentEl?.scrollTo(0, 0)
  })

  // A view that swaps sections inside this container asks for the same reset with
  // `document.dispatchEvent(new Event('tom:scrolltop'))` — the scroll container is App's, not theirs.
  $effect(() => {
    const el = contentEl
    if (!el) return
    const reset = () => el.scrollTo(0, 0)
    document.addEventListener('tom:scrolltop', reset)
    return () => document.removeEventListener('tom:scrolltop', reset)
  })
</script>

<Toast />
<ConnectionIndicator bind:height={bridgeBarHeight} />

<div class="app">
  <Header title="Ocular Migraine">
    {#snippet status()}
      <!-- Labelled: an unlabelled percentage next to the phone's own status bar reads as the phone's. -->
      <span
        class="status-chip"
        class:low={device.battery > 0 && device.battery < 20}
        class:charging={device.charging}
        class:unknown={!device.battery}
      >
        Headset {device.battery ? `${device.battery}%` : '—'}{device.charging ? ' charging' : ''}
      </span>
    {/snippet}
  </Header>
  <main class="content" bind:this={contentEl} style:padding-bottom={contentPadding}>
    {#if getActiveTab() === 'tune'}
      <Tune />
    {:else if getActiveTab() === 'recording'}
      <Recording />
    {:else if getActiveTab() === 'system'}
      <System />
    {/if}
  </main>
  <TabBar />
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
    /* padding-bottom is set inline: it clears the fixed TabBar (which carries the safe-area inset
       inside its own height) plus the measured ConnectionIndicator bar standing above it. */
  }

  .status-chip {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--success);
  }

  /* Ordered so a low battery still reads red while charging. */
  .status-chip.charging {
    color: var(--warning);
  }

  .status-chip.low {
    color: var(--danger);
  }

  .status-chip.unknown {
    color: var(--text-muted);
  }
</style>
