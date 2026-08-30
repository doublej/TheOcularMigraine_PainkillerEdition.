<script lang="ts">
  import { t } from '../../i18n/index.svelte'

  import type { Snippet } from 'svelte'

  let { title = '', status }: { title?: string; status?: Snippet } = $props()
</script>

<header class="header">
  <div class="header-top">
    <div class="lockup">
      <!-- An homage to petermg's banner: his vesica eye, his blazing core. The launcher icon
           and the splash carry a scintillating iris; below about 40px those teeth turn to mush
           and the eye stops reading as an eye, so this copy wears a plain ring. One drawing,
           two sizes — tools/gen-icons.py renders the other one. -->
      <svg class="mark" viewBox="10 54 220 132" fill="none" aria-hidden="true">
        <path
          d="M 20 120 A 117.3 117.3 0 0 1 220 120 A 117.3 117.3 0 0 1 20 120"
          stroke="var(--text)"
          stroke-width="17"
          stroke-linejoin="round"
        />
        <circle cx="120" cy="120" r="43" stroke="var(--primary)" stroke-width="14" />
        <circle cx="120" cy="120" r="14" fill="var(--text)" />
      </svg>
      <div class="names">
        <!-- The app's own name, from the original: "The Ocular Migraine: {Dev Mode} Master
             Control Program". A name is not translated, so it never goes through t(). -->
        <span class="kicker">
          <span class="brace">&#123;</span>{t('header.devMode')}<span class="brace">&#125;</span>
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

  /* The battery chip reads "Headset 100% charging" at its longest, which no longer fits beside
     the lockup on a narrow phone — so it drops to its own line there rather than squeezing
     either one. On the headset and on any normal phone this stays a single row. */
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
    width: 38px;
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
