<script lang="ts">
  import { t } from '../../i18n/index.svelte'
  import type { Snippet } from 'svelte'
  let { title = '', status }: { title?: string; status?: Snippet } = $props()
</script>
<header class="header">
  <div class="header-top">
    <div class="lockup">
      <!-- An homage to petermg's banner: his vesica eye, his scintillating iris, his blazing
           core. The same drawing as the launcher icon and the splash, at the same weights —
           tools/gen-icons.py renders those. Strokes are hairlines here on purpose: 1.5px and
           1.2px once the 220-unit viewBox is scaled to 42, which is what keeps the eye fine
           rather than blobby. The iris is drawn twice, once wide and faint as its own glow. -->
      <svg class="mark" viewBox="10 54 220 132" fill="none" aria-hidden="true">
        <path
          d="M 20 120 A 117.3 117.3 0 0 1 220 120 A 117.3 117.3 0 0 1 20 120"
          stroke="var(--text)"
          stroke-width="7.5"
          stroke-linejoin="round"
        />
        <path
          d="M 120.0 74.0 L 127.0 84.7 L 137.6 77.5 L 140.0 90.1 L 152.5 87.5 L 149.9 100.0 L 162.5 102.4 L 155.3 113.0 L 166.0 120.0 L 155.3 127.0 L 162.5 137.6 L 149.9 140.0 L 152.5 152.5 L 140.0 149.9 L 137.6 162.5 L 127.0 155.3 L 120.0 166.0 L 113.0 155.3 L 102.4 162.5 L 100.0 149.9 L 87.5 152.5 L 90.1 140.0 L 77.5 137.6 L 84.7 127.0 L 74.0 120.0 L 84.7 113.0 L 77.5 102.4 L 90.1 100.0 L 87.5 87.5 L 100.0 90.1 L 102.4 77.5 L 113.0 84.7 Z"
          stroke="var(--primary)"
          stroke-width="18"
          stroke-linejoin="round"
          opacity="0.16"
        />
        <path
          d="M 120.0 74.0 L 127.0 84.7 L 137.6 77.5 L 140.0 90.1 L 152.5 87.5 L 149.9 100.0 L 162.5 102.4 L 155.3 113.0 L 166.0 120.0 L 155.3 127.0 L 162.5 137.6 L 149.9 140.0 L 152.5 152.5 L 140.0 149.9 L 137.6 162.5 L 127.0 155.3 L 120.0 166.0 L 113.0 155.3 L 102.4 162.5 L 100.0 149.9 L 87.5 152.5 L 90.1 140.0 L 77.5 137.6 L 84.7 127.0 L 74.0 120.0 L 84.7 113.0 L 77.5 102.4 L 90.1 100.0 L 87.5 87.5 L 100.0 90.1 L 102.4 77.5 L 113.0 84.7 Z"
          stroke="var(--primary)"
          stroke-width="6"
          stroke-linejoin="round"
        />
        <circle cx="120" cy="120" r="14" fill="var(--text)" />
      </svg>
      <div class="names">
        <!-- The braces are petermg's, off the original banner; the words inside them are this
             fork's. His app is the migraine, this is what you take for it. -->
        <span class="kicker">
          <span class="brace">&#123;</span>{t('header.edition')}<span class="brace">&#125;</span>
        </span>
        <h1>{title}</h1>
      </div>
    </div>
    {#if status}
      <div class="header-status">
        {@render status()}
      </div>
    {/if}
  </div>
</header>
<style>
  .header {
    flex-shrink: 0;
    /* viewport-fit=cover is set in index.html, so the title must clear a notch on its own. */
    padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 0;
  }
  /* The mark costs the row 50px, so the battery chip no longer always fits beside it: it drops
     to its own line rather than squeezing either one. Measured — the everyday "Headset 78%" keeps
     a single row down to 360px, and only the longest state, "Headset 100% charging", wraps on a
     phone. The headset itself is far wider than any of this. */
  .header-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 10px;
  }
  .lockup {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mark {
    width: 42px;
    height: auto;
    flex-shrink: 0;
  }
  .names {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .brace {
    color: var(--primary);
  }
  h1 {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .header-status {
    display: flex;
    align-items: center;
    margin-left: auto;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
