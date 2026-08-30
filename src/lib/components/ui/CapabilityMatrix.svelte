<script lang="ts">
  import { abilityLabel, whyNot, abilitiesFor, type AbilityKey, type Privilege } from '../../bridge/capabilities'
  import { t } from '../../i18n/index.svelte'

  let { privilege }: { privilege: Privilege } = $props()

  // Ordered so the things a fresh headset install can already do come first.
  const KEYS: AbilityKey[] = [
    'readProps', 'listPackages', 'launchApps', 'deviceServices', 'installApk',
    'writeProps', 'manageApps',
  ]

  const can = $derived(abilitiesFor(privilege))
</script>

<ul class="matrix">
  {#each KEYS as key}
    <li class="row" class:no={!can[key]}>
      <span class="mark" aria-hidden="true">{can[key] ? '✓' : '✕'}</span>
      <span class="body">
        <span class="label">{abilityLabel(key)}</span>
        <span class="verdict">{can[key] ? t('caps.can') : t('caps.cannot')}</span>
        {#if !can[key]}
          <span class="why">{whyNot(key, privilege)}</span>
        {/if}
      </span>
    </li>
  {/each}
</ul>

<style>
  .matrix {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .row.no {
    border-color: var(--warning);
  }

  .mark {
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 1.3;
    color: var(--primary);
  }

  .row.no .mark {
    color: var(--warning);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: 14px;
    color: var(--text);
  }

  /* Carries the state for a screen reader, which cannot read the tick, and is hidden by eye. */
  .verdict {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .why {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
</style>
