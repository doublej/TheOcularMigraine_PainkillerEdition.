<script module lang="ts">
  // App.svelte destroys this view on every tab switch, so the headset read belongs to the app
  // launch, not the mount — otherwise every visit to Tune costs fifteen ADB round trips.
  // Set only once a real headset answered: latching it on a failed or fixture read is what
  // left the whole session on guesses when the bridge was not up yet at launch.
  let hasReadDevice = false
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import LevelPicker from '../lib/components/ui/LevelPicker.svelte'
  import Slider from '../lib/components/ui/Slider.svelte'
  import FrequencyPicker from '../lib/components/ui/FrequencyPicker.svelte'
  import AppPicker from '../lib/components/ui/AppPicker.svelte'
  import {
    getDevice, getDisplay, getCaps, getUnsetDisplayKeys, isDemoMode, updateDisplay,
    getProfiles, addProfile, removeProfile, refreshDevice,
    isDeviceInfoFixture, getServerConnected, getAbilities, getPrivilege,
    type DisplaySettings, type GameProfile,
  } from '../lib/stores/device.svelte'
  import { whyNot } from '../lib/bridge/capabilities'
  import { t, type PlainKey } from '../lib/i18n/index.svelte'
  import { showToast } from '../lib/stores/toast.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'

  // Rungs are multipliers of the detected panel, never literals: every rung then holds the
  // headset's own aspect and orders correctly, on any model.
  const SCALES: { key: PlainKey; mul: number }[] = [
    { key: 'tune.res.smoothest', mul: 0.7 },
    { key: 'tune.res.smoother',  mul: 0.85 },
    { key: 'tune.res.native',    mul: 1 },
    { key: 'tune.res.sharper',   mul: 1.15 },
    { key: 'tune.res.sharpest',  mul: 1.3 },
  ]

  /** The props this screen owns — the narrow reset, as opposed to the whole debug.oculus namespace. */
  const PERF_PROPS = [
    'debug.oculus.textureWidth', 'debug.oculus.textureHeight', 'debug.oculus.refreshRate',
    'debug.oculus.cpuLevel', 'debug.oculus.gpuLevel', 'debug.oculus.ffrLevel',
    'debug.oculus.adaclocks.cpuDynamic', 'debug.oculus.adaclocks.gpuDynamic', 'debug.oculus.ffrDynamic',
  ]

  /** Auto is one prop per level, written on its own so flipping it never invents a level. */
  const AUTO_PROPS = {
    cpuDynamic: 'debug.oculus.adaclocks.cpuDynamic',
    gpuDynamic: 'debug.oculus.adaclocks.gpuDynamic',
    ffrDynamic: 'debug.oculus.ffrDynamic',
  } as const

  /** Every rate some Quest runs. Offered when the model is unknown, so no list is stated as fact. */
  const ALL_RATES = [60, 72, 90, 120]

  const device = $derived(getDevice())
  const display = $derived(getDisplay())
  const caps = $derived(getCaps())
  const unset = $derived(getUnsetDisplayKeys())
  const profiles = $derived(getProfiles())
  const fixture = $derived(isDeviceInfoFixture())
  const autoUnset = $derived(unset.some(k => k.endsWith('Dynamic')))

  const steps = $derived(SCALES.map(s => ({
    // caps.known false means the panel is a fallback guess — then no rung may be called "Native".
    label: caps.known ? t(s.key) : `${Math.round(s.mul * 100)}%`,
    w: Math.round(caps.nativeWidth * s.mul),
    h: Math.round(caps.nativeHeight * s.mul),
  })))
  const resUnset = $derived(unset.includes('resolutionWidth') || unset.includes('resolutionHeight'))
  const activeStep = $derived(resUnset
    ? ''
    : steps.find(s => s.w === display.resolutionWidth && s.h === display.resolutionHeight)?.label ?? '')
  const nativePct = $derived(Math.round((display.resolutionWidth / caps.nativeWidth) * 100))

  // The pickers bind here, never straight into the store: a value is committed only once the
  // headset accepted the write, and a failure snaps these back to what the store still holds.
  let pending = $state(levelsOf(getDisplay()))

  let scale = $state(1)
  const scaledW = $derived(Math.round(caps.nativeWidth * scale))
  const scaledH = $derived(Math.round(caps.nativeHeight * scale))

  let refreshing = $state(false)
  let clearing = $state(false)
  let busyPreset = $state('')
  let busyProfile = $state('')
  let showCustom = $state(false)
  let showPresetList = $state(false)
  let presets = $state(persistence.loadPresets())
  let appPickerOpen = $state(false)
  let naming = $state<'preset' | 'profile' | ''>('')
  let nameDraft = $state('')
  let namedPackage = ''
  /** Id of the action waiting for its second tap. One at a time, so arming disarms the rest. */
  let armed = $state('')
  let armTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Any action in flight that would overwrite the controls below — a clear sweeps all nine props,
   * a preset or profile writes five, a read replaces the lot. Every one of them goes dead while
   * it runs, so a tap cannot toast a value the running action is about to blank.
   */
  const busy = $derived(refreshing || clearing || busyPreset !== '' || busyProfile !== '')

  /**
   * Everything on this screen writes a render prop, so a route that cannot write them must not
   * offer a control that would fail on tap. Reading the headset stays available, so the Read
   * button keeps using `busy` alone.
   */
  const can = $derived(getAbilities())
  const locked = $derived(busy || !can.writeProps)

  function levelsOf(s: DisplaySettings) {
    const { cpuLevel, gpuLevel, ffrLevel, cpuDynamic, gpuDynamic, ffrDynamic, refreshRate } = s
    return { cpuLevel, gpuLevel, ffrLevel, cpuDynamic, gpuDynamic, ffrDynamic, refreshRate }
  }

  /** Rollback: snaps every bound control back to the last value the headset actually took. */
  function syncPending() {
    Object.assign(pending, levelsOf(display))
  }

  function describe(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  function summarize(s: DisplaySettings): string {
    return `${s.refreshRate} Hz · ${s.resolutionWidth}×${s.resolutionHeight} · CPU ${s.cpuLevel} · GPU ${s.gpuLevel} · FFR ${s.ffrLevel}`
  }

  /** Says where the write actually went — in demo mode nothing reached a headset. */
  function reportApplied(what: string) {
    if (isDemoMode()) showToast(`${what} — demo mode, nothing was sent`, 'info', 1600)
    else showToast(what, 'success', 1400)
  }

  /**
   * Two-step confirm: the first tap arms, the second runs. Arming expires after 5s and on leaving
   * the view, so an ordinary double-tap or a stray later tap cannot walk straight through it.
   */
  function confirmTap(id: string, run: () => void) {
    clearTimeout(armTimer)
    if (armed === id) {
      armed = ''
      run()
      return
    }
    armed = id
    armTimer = setTimeout(() => { armed = '' }, 5000)
  }

  /** Also the unmount hook: leaving the view must not leave a destructive control armed. */
  function disarm() {
    clearTimeout(armTimer)
    armed = ''
  }

  async function applySetting(write: () => Promise<void>, patch: Partial<DisplaySettings>, what: string) {
    try {
      await write()
      updateDisplay(patch)
      reportApplied(what)
    } catch (e) {
      syncPending()
      showToast(`${what} failed: ${describe(e)}`, 'error')
    }
  }

  function applyCpu(v: number, d: boolean) {
    return applySetting(() => adb.setCpuLevel(v, d), { cpuLevel: v, cpuDynamic: d }, `CPU level ${v}`)
  }

  function applyGpu(v: number, d: boolean) {
    return applySetting(() => adb.setGpuLevel(v, d), { gpuLevel: v, gpuDynamic: d }, `GPU level ${v}`)
  }

  function applyFfr(v: number, d: boolean) {
    return applySetting(() => adb.setFfrLevel(v, d), { ffrLevel: v, ffrDynamic: d }, `Foveation level ${v}`)
  }

  function applyRate(hz: number) {
    return applySetting(() => adb.setRefreshRate(hz), { refreshRate: hz }, `${hz} Hz`)
  }

  /**
   * Auto is a prop of its own. adb.setCpuLevel writes the level alongside it, so routing the chip
   * through it wrote debug.oculus.cpuLevel 3 — a level the user never chose — on a headset that
   * had none. The chip writes only the dynamic prop, and the level stays "headset default".
   *
   * The checkbox flips itself, so pending moves first or a failed write has nothing to snap back from.
   */
  async function applyAuto(key: keyof typeof AUTO_PROPS, on: boolean, what: string) {
    pending[key] = on
    const patch: Partial<DisplaySettings> = {}
    patch[key] = on
    await applySetting(() => adb.setprop(AUTO_PROPS[key], on ? 1 : 0), patch, `${what} ${on ? 'on' : 'off'}`)
  }

  async function applyResolution(w: number, h: number) {
    try {
      await adb.setResolution(w, h)
      updateDisplay({ resolutionWidth: w, resolutionHeight: h })
      reportApplied(`Render resolution ${w} × ${h} per eye`)
    } catch (e) {
      showToast(`Render resolution failed: ${describe(e)}`, 'error')
    }
  }

  function toggleCustom() {
    showCustom = !showCustom
    // Clamped to the slider's own domain: unclamped, the thumb pins at 1.4x while scaledW/H
    // still carry the wild value, so the button would apply a size the readout never showed.
    if (showCustom) {
      const snapped = Math.round((display.resolutionWidth / caps.nativeWidth) * 20) / 20
      scale = Math.min(1.4, Math.max(0.5, snapped))
    }
  }

  /** Writes a whole set sequentially so a failure stops at a known prop. Throws — the caller reports. */
  async function writeDisplay(s: DisplaySettings) {
    await adb.setResolution(s.resolutionWidth, s.resolutionHeight)
    await adb.setRefreshRate(s.refreshRate)
    await adb.setCpuLevel(s.cpuLevel, s.cpuDynamic)
    await adb.setGpuLevel(s.gpuLevel, s.gpuDynamic)
    await adb.setFfrLevel(s.ffrLevel, s.ffrDynamic)
  }

  async function refresh() {
    refreshing = true
    try {
      await refreshDevice()
      syncPending()
      // Assigned inside the try and before the finally, so the $effect below never sees
      // "not reading, not read yet" and fires a second time. A fixture read is not a headset read.
      hasReadDevice = !isDeviceInfoFixture()
    } catch (e) {
      showToast(`Could not read the headset: ${describe(e)}`, 'error')
    } finally {
      refreshing = false
    }
  }

  async function applyProfile(profile: GameProfile, launch: boolean) {
    busyProfile = profile.id
    try {
      // Resolution binds when the app starts, so the write has to land before the launch.
      await writeDisplay(profile.display)
      updateDisplay(profile.display)
      syncPending()
      if (launch) await adb.launchApp(profile.packageName)
      reportApplied(launch ? `Launching ${profile.name}` : `Applied “${profile.name}”`)
    } catch (e) {
      showToast(`${profile.name} failed: ${describe(e)}`, 'error')
    } finally {
      busyProfile = ''
    }
  }

  async function loadPreset(preset: persistence.DisplayPreset) {
    busyPreset = preset.id
    try {
      await writeDisplay(preset.settings)
      updateDisplay(preset.settings)
      syncPending()
      reportApplied(`Applied “${preset.name}”`)
    } catch (e) {
      showToast(`Preset “${preset.name}” failed: ${describe(e)}`, 'error')
    } finally {
      busyPreset = ''
    }
  }

  async function clearPerformance() {
    clearing = true
    try {
      // Empty string, not the two characters `''`: setprop() quotes the value itself and then
      // proves the write by reading it back, so a literal quote pair would never match.
      for (const prop of PERF_PROPS) await adb.setprop(prop, '')
      // Through reportApplied like every other write here, so a demo clear cannot toast green.
      reportApplied('Performance props cleared — the headset picks its own again')
    } catch (e) {
      showToast(`Clear failed: ${describe(e)}`, 'error')
    } finally {
      await refresh()
      clearing = false
    }
  }

  async function clearEverything() {
    clearing = true
    try {
      const props = await adb.getCurrentOculusProps()
      // The mock table answers `getprop` with six invented props. Snapshotting those would push the
      // last real backup out of the three-deep ring, so a fixture read is a failure, not a backup.
      if (adb.isFixtureRead()) throw new Error('no headset attached — nothing was read or cleared')
      const backup = persistence.saveSettingsBackup(props)
      await adb.clearAllSettings()
      showToast(backup
        ? 'Cleared — the old props are in Settings Backup'
        : 'Cleared — nothing was set, so there was nothing to back up', 'success')
    } catch (e) {
      showToast(`Clear failed: ${describe(e)}`, 'error')
    } finally {
      await refresh()
      clearing = false
    }
  }

  function startNaming(kind: 'preset' | 'profile', suggested: string) {
    naming = kind
    nameDraft = suggested
  }

  function cancelNaming() {
    naming = ''
    nameDraft = ''
    namedPackage = ''
  }

  function saveNamed() {
    const name = nameDraft.trim()
    if (naming === 'preset') {
      presets = [...presets, { id: persistence.makeId(), name, settings: { ...display } }]
      persistence.savePresets(presets)
      showPresetList = true
    } else {
      addProfile({ id: persistence.makeId(), name, packageName: namedPackage, display: { ...display }, isDefault: false })
    }
    showToast(`Saved “${name}”`, 'success')
    cancelNaming()
  }

  function pickProfileApp(pkg: string) {
    namedPackage = pkg
    appPickerOpen = false
    startNaming('profile', pkg.split('.').pop() || pkg)
  }

  function deletePreset(id: string) {
    presets = presets.filter(p => p.id !== id)
    persistence.savePresets(presets)
    showToast('Preset deleted', 'success', 1400)
  }

  function deleteProfile(id: string) {
    removeProfile(id)
    showToast('Profile deleted', 'success', 1400)
  }

  onMount(() => {
    if (!hasReadDevice) void refresh()
    return disarm
  })

  // The bridge is usually not up at launch and this is the landing page, so a first read that
  // reached nothing has to be retried when the connection arrives — once per arrival, never in a
  // loop: a failed read leaves `live` unchanged, so `arrived` is false on every follow-up run.
  let wasLive = false
  $effect(() => {
    const live = !isDemoMode() && getServerConnected()
    const arrived = live && !wasLive
    wasLive = live
    if (arrived && !hasReadDevice && !refreshing) void refresh()
  })
</script>

{#snippet nameRow()}
  <div class="name-row">
    <input class="name-input" bind:value={nameDraft} placeholder={t('tune.name.placeholder')} />
    <Button size="sm" variant="primary" onclick={saveNamed} disabled={!nameDraft.trim()}>{t('common.save')}</Button>
    <Button size="sm" variant="ghost" onclick={cancelNaming}>{t('common.cancel')}</Button>
  </div>
{/snippet}

<div class="tune">
  <div class="device-line">
    <span class="device-model" class:unknown={!device.model || fixture}>
      {#if !device.model}
        {t('tune.device.noRead')}
      {:else if fixture}
        {t('tune.device.demo', { label: caps.label })}
      {:else}
        {caps.label}
      {/if}
    </span>
    <Button variant="ghost" size="sm" onclick={refresh} disabled={busy}>
      {refreshing ? t('tune.device.reading') : t('tune.device.read')}
    </Button>
  </div>

  {#if !can.writeProps}
    <p class="warn">
      {t('tune.warn.cannotWrite')} {whyNot('writeProps', getPrivilege())}
    </p>
  {/if}

  {#if device.model && !fixture && !caps.known}
    <p class="warn">{t('tune.warn.unknownHeadset', { model: device.model })}</p>
  {/if}

  <Card title={t('tune.card.performance')}>
    <fieldset class="group" disabled={locked}>
    <div class="level-row">
      <div class="level-slot slot-cpu">
        <LevelPicker
          label={t('tune.cpu.label')}
          bind:value={pending.cpuLevel}
          dynamic={pending.cpuDynamic}
          showDynamic={false}
          unset={unset.includes('cpuLevel')}
          color="var(--accent-seafoam)"
          onchange={applyCpu}
        />
      </div>
      <div class="level-slot slot-gpu">
        <LevelPicker
          label={t('tune.gpu.label')}
          bind:value={pending.gpuLevel}
          dynamic={pending.gpuDynamic}
          showDynamic={false}
          unset={unset.includes('gpuLevel')}
          color="var(--accent-grape)"
          onchange={applyGpu}
        />
      </div>
      <div class="level-slot slot-blur">
        <LevelPicker
          label={t('tune.ffr.label')}
          bind:value={pending.ffrLevel}
          dynamic={pending.ffrDynamic}
          showDynamic={false}
          unset={unset.includes('ffrLevel')}
          color="var(--accent-teal)"
          onchange={applyFfr}
        />
      </div>
    </div>
    <div class="auto-row">
      <label class="auto-chip" class:unset={unset.includes('cpuDynamic')}>
        <input
          type="checkbox"
          checked={pending.cpuDynamic}
          indeterminate={unset.includes('cpuDynamic')}
          onchange={(e) => applyAuto('cpuDynamic', e.currentTarget.checked, t('tune.auto.cpu'))}
        />
        {t('tune.auto.cpu')}
      </label>
      <label class="auto-chip" class:unset={unset.includes('gpuDynamic')}>
        <input
          type="checkbox"
          checked={pending.gpuDynamic}
          indeterminate={unset.includes('gpuDynamic')}
          onchange={(e) => applyAuto('gpuDynamic', e.currentTarget.checked, t('tune.auto.gpu'))}
        />
        {t('tune.auto.gpu')}
      </label>
      <label class="auto-chip" class:unset={unset.includes('ffrDynamic')}>
        <input
          type="checkbox"
          checked={pending.ffrDynamic}
          indeterminate={unset.includes('ffrDynamic')}
          onchange={(e) => applyAuto('ffrDynamic', e.currentTarget.checked, t('tune.auto.ffr'))}
        />
        {t('tune.auto.ffr')}
      </label>
    </div>
    </fieldset>
    <p class="hint">
      {t('tune.perf.hint')}
      {#if autoUnset}{t('tune.perf.autoUnsetHint')}{/if}
    </p>
  </Card>

  <Card title={t('tune.card.display')}>
    <fieldset class="group" disabled={locked}>
      <FrequencyPicker
        label={t('tune.refresh.label')}
        bind:value={pending.refreshRate}
        options={caps.known ? caps.refreshRates : ALL_RATES}
        unset={unset.includes('refreshRate')}
        onchange={applyRate}
      />
    </fieldset>
    <p class="hint">
      {t('tune.refresh.hint')}
      {caps.known ? t('tune.refresh.hintKnown') : t('tune.refresh.hintUnknown')}
    </p>
  </Card>

  <Card title={t('tune.card.resolution')}>
    <div class="res-display">
      {#if resUnset}
        <span class="res-unset">{t('common.headsetDefault')}</span>
      {:else}
        <div class="res-value">
          <span class="mono">{display.resolutionWidth}</span>
          <span class="res-x">×</span>
          <span class="mono">{display.resolutionHeight}</span>
        </div>
        {#if caps.known}<span class="res-ratio">{t('tune.res.ofNative', { pct: nativePct })}</span>{/if}
      {/if}
    </div>
    <p class="hint">{t('tune.res.hint')}</p>
    <fieldset class="group" disabled={locked}>
    <div class="res-grid">
      {#each steps as step}
        <button
          class="res-cell"
          class:active={activeStep === step.label}
          onclick={() => applyResolution(step.w, step.h)}
        >
          <span class="res-cell-label">{step.label}</span>
          <span class="res-cell-dims mono">{step.w}×{step.h}</span>
        </button>
      {/each}
      <button class="res-cell" class:active={showCustom} onclick={toggleCustom}>
        <span class="res-cell-label">{t('tune.res.custom')}</span>
        <span class="res-cell-dims mono">{showCustom ? '▲' : '▼'}</span>
      </button>
    </div>
    {#if showCustom}
      <div class="res-custom">
        <Slider bind:value={scale} min={0.5} max={1.4} step={0.05} label={t('tune.res.scaleLabel')} unit="x" />
        <p class="res-scaled">
          <span class="mono">{scaledW} × {scaledH}</span> {t('tune.res.perEyeDash')}
          {caps.known ? t('tune.res.panelKnown', { label: caps.label }) : t('tune.res.panelUnknown')}
          <span class="mono">{caps.nativeWidth} × {caps.nativeHeight}</span>
        </p>
        <Button variant="primary" onclick={() => applyResolution(scaledW, scaledH)}>{t('tune.res.apply')}</Button>
      </div>
    {/if}
    </fieldset>
  </Card>

  <Card title={t('tune.card.profiles')}>
    <p class="hint">{t('tune.profiles.hint')}</p>
    {#if profiles.length === 0}
      <p class="empty">{t('tune.profiles.empty')}</p>
    {:else}
      <div class="row-list">
        {#each profiles as profile (profile.id)}
          <div class="profile-item">
            <div class="profile-head">
              <span class="profile-name">{profile.name}</span>
              {#if profile.isDefault}<span class="badge">{t('tune.profiles.default')}</span>{/if}
            </div>
            <span class="row-meta mono">{summarize(profile.display)}</span>
            <div class="row-actions">
              {#if busyProfile === profile.id}
                <span class="row-busy">{t('common.applying')}</span>
              {:else}
                <Button
                  disabled={locked}
                  onclick={() => confirmTap(`apply:${profile.id}`, () => applyProfile(profile, false))}
                >
                  {armed === `apply:${profile.id}` ? t('common.tapAgain') : t('tune.profile.apply')}
                </Button>
                <Button
                  disabled={locked}
                  onclick={() => confirmTap(`launch:${profile.id}`, () => applyProfile(profile, true))}
                >
                  {armed === `launch:${profile.id}` ? t('tune.profile.tapLaunch') : t('tune.profile.launch')}
                </Button>
                <button
                  class="row-del"
                  class:armed={armed === `profile:${profile.id}`}
                  onclick={() => confirmTap(`profile:${profile.id}`, () => deleteProfile(profile.id))}
                >
                  {armed === `profile:${profile.id}` ? t('common.tapAgain') : t('common.delete')}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {#if naming === 'profile'}
      {@render nameRow()}
    {:else}
      <Button onclick={() => (appPickerOpen = true)}>{t('tune.profiles.save')}</Button>
    {/if}
  </Card>
  <AppPicker bind:open={appPickerOpen} title={t('tune.appPicker.title')} onselect={pickProfileApp} />

  <Card title={t('tune.card.presets')}>
    <p class="hint">{t('tune.presets.hint')}</p>
    <div class="stack">
      {#if naming === 'preset'}
        {@render nameRow()}
      {:else}
        <Button onclick={() => startNaming('preset', t('tune.presets.suggestedName', { w: display.resolutionWidth, h: display.resolutionHeight, hz: display.refreshRate }))}>
          {t('tune.presets.save')}
        </Button>
      {/if}
      <Button onclick={() => (showPresetList = !showPresetList)} disabled={presets.length === 0}>
        {showPresetList ? t('tune.presets.hide') : t('tune.presets.count', { n: presets.length })}
      </Button>
      {#if showPresetList && presets.length > 0}
        <div class="row-list">
          {#each presets as preset (preset.id)}
            <div class="preset-item">
              <button
                class="preset-main"
                class:armed={armed === `preset-apply:${preset.id}`}
                disabled={locked}
                onclick={() => confirmTap(`preset-apply:${preset.id}`, () => loadPreset(preset))}
              >
                <span class="preset-name">
                  {#if busyPreset === preset.id}
                    {t('common.applying')}
                  {:else if armed === `preset-apply:${preset.id}`}
                    {t('tune.presets.tapOverwrite')}
                  {:else}
                    {preset.name}
                  {/if}
                </span>
                <span class="row-meta mono">{summarize(preset.settings)}</span>
              </button>
              <button
                class="row-del"
                class:armed={armed === `preset:${preset.id}`}
                onclick={() => confirmTap(`preset:${preset.id}`, () => deletePreset(preset.id))}
              >
                {armed === `preset:${preset.id}` ? t('common.tapAgain') : t('common.delete')}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Card>

  <Card title={t('tune.card.reset')}>
    <div class="stack">
      <Button disabled={locked} onclick={() => confirmTap('perf', clearPerformance)}>
        {clearing ? t('tune.reset.clearing') : armed === 'perf' ? t('tune.reset.tapPerf') : t('tune.reset.perf')}
      </Button>
      <p class="hint">{t('tune.reset.perfHint')}</p>
      <Button variant="danger" disabled={locked} onclick={() => confirmTap('all', clearEverything)}>
        {clearing ? t('tune.reset.clearing') : armed === 'all' ? t('tune.reset.tapAll') : t('tune.reset.all')}
      </Button>
      <p class="hint">{t('tune.reset.allHint')}</p>
    </div>
  </Card>
</div>

<style>
  .tune {
    padding: 0 16px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .device-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 40px;
  }

  .device-model {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }

  .device-model.unknown {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 400;
    color: var(--warning);
  }

  .hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-secondary);
  }

  .warn {
    font-size: 12px;
    line-height: 1.4;
    color: var(--warning);
  }

  /* fieldset[disabled] switches off every control inside it natively — including the buttons the
     pickers render — so an action that overwrites these values takes them all offline at once. */
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  .group:disabled {
    opacity: 0.45;
  }

  /* Performance — three compact pickers sharing one row keeps resolution above the fold */
  .level-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .auto-row {
    display: flex;
    gap: 6px;
    margin: 8px 0;
  }

  /* Three 5-step strips need 660px to keep 44px targets, so on a phone they stack.
     display:contents lifts both rows into one grid so each Auto chip keeps its level. */
  @media (max-width: 560px) {
    .level-row:has(+ .auto-row) {
      display: contents;
    }

    .auto-row:not(:first-child) {
      display: contents;
    }

    .group:has(> .level-row) {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .slot-cpu { order: 1; }
    .auto-row > :nth-child(1) { order: 2; }
    .slot-gpu { order: 3; }
    .auto-row > :nth-child(2) { order: 4; }
    .slot-blur { order: 5; }
    .auto-row > :nth-child(3) { order: 6; }
  }

  .auto-chip {
    flex: 1;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  /* No value on the headset yet — dashed, matching the indeterminate box inside it. */
  .auto-chip.unset {
    border-style: dashed;
    color: var(--text-muted);
  }

  .auto-chip input {
    accent-color: var(--primary);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  /* Resolution */
  .res-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 4px;
  }

  .res-value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--primary);
    font-size: 26px;
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .res-x {
    font-size: 16px;
    color: var(--text-muted);
    font-weight: 400;
  }

  .res-ratio {
    font-size: 13px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    background: var(--surface-elevated);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .res-unset {
    font-size: 15px;
    color: var(--text-muted);
  }

  .res-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: 8px;
  }

  .res-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 48px;
    padding: 6px 4px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .res-cell:active {
    transform: scale(0.97);
  }

  .res-cell.active {
    background: var(--primary-glow);
    border-color: color-mix(in srgb, var(--primary) 30%, transparent);
    color: var(--primary);
  }

  .res-cell-label {
    font-size: 12px;
    font-weight: 600;
  }

  .res-cell-dims {
    font-size: 10px;
    opacity: 0.7;
  }

  .res-custom {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .res-scaled {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-secondary);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .empty {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.6;
    margin-bottom: 12px;
  }

  /* Saved rows — profiles and presets */
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0;
  }

  .profile-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .profile-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .profile-name {
    font-size: 15px;
    font-weight: 500;
  }

  .row-meta {
    font-size: 11px;
    color: var(--text-muted);
  }

  .row-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 48px;
  }

  .row-busy {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .row-del {
    min-height: 44px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .row-del:active {
    transform: scale(0.97);
  }

  .row-del.armed {
    border-color: var(--danger-dim);
    color: var(--danger);
  }

  .badge {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--primary);
    background: var(--primary-glow);
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
  }

  .preset-item {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }

  .preset-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .preset-main:active {
    transform: scale(0.97);
  }

  .preset-main:disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .preset-main.armed {
    border-color: var(--warning);
  }

  .preset-main.armed .preset-name {
    color: var(--warning);
  }

  .preset-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name-input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 14px;
  }

  .name-input:focus {
    outline: none;
    border-color: var(--primary);
  }

  @media (hover: hover) {
    .res-cell:hover { background: var(--surface-hover); }
    .preset-main:hover { background: var(--surface-hover); }
    .row-del:hover { color: var(--text-secondary); }
    .auto-chip:hover { background: var(--surface-hover); }
  }
</style>
