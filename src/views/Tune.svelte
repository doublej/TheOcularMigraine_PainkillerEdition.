<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import LevelPicker from '../lib/components/ui/LevelPicker.svelte'
  import Slider from '../lib/components/ui/Slider.svelte'
  import FrequencyPicker from '../lib/components/ui/FrequencyPicker.svelte'
  import AppPicker from '../lib/components/ui/AppPicker.svelte'
  import { getDevice, getDisplay, updateDisplay, getProfiles, addProfile, refreshDevice, type GameProfile } from '../lib/stores/device.svelte'
  import { showToast } from '../lib/stores/toast.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'

  const RESOLUTIONS = [
    { label: 'Max',         w: 3072, h: 3380 },
    { label: 'Supersample', w: 2560, h: 2816 },
    { label: 'Native',      w: 2064, h: 2208 },
    { label: 'High',        w: 2048, h: 2253 },
    { label: 'Balanced',    w: 1832, h: 1920 },
    { label: 'Default',     w: 1680, h: 1760 },
    { label: 'Performance', w: 1440, h: 1584 },
    { label: 'Low',         w: 1024, h: 1127 },
  ]

  const device = $derived(getDevice())
  const display = $derived(getDisplay())
  const profiles = $derived(getProfiles())

  let refreshing = $state(false)
  let resW = $state(1832)
  let resH = $state(1920)
  let aspectRatio = $derived(+(resH / resW).toFixed(2))
  let showCustomRes = $state(false)
  let activePreset = $derived(RESOLUTIONS.find(r => r.w === resW && r.h === resH)?.label ?? null)

  let profileSection: 'list' | 'save' = $state('list')
  let appPickerOpen = $state(false)
  let showPresetList = $state(false)
  let presets = $state(persistence.loadPresets())

  async function applySetting(fn: () => Promise<void>) {
    try {
      await fn()
      persistence.saveDisplaySettings(display)
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : e}`, 'error', 4000)
    }
  }

  async function refresh() {
    refreshing = true
    await refreshDevice()
    refreshing = false
  }

  async function applyDisplayToDevice(settings: typeof display) {
    updateDisplay(settings)
    try {
      await Promise.all([
        adb.setResolution(settings.resolutionWidth, settings.resolutionHeight),
        adb.setRefreshRate(settings.refreshRate),
        adb.setCpuLevel(settings.cpuLevel, settings.cpuDynamic),
        adb.setGpuLevel(settings.gpuLevel, settings.gpuDynamic),
        adb.setFfrLevel(settings.ffrLevel, settings.ffrDynamic),
      ])
      showToast('Settings applied', 'success')
    } catch (e) {
      showToast(`Failed to apply: ${e instanceof Error ? e.message : e}`, 'error', 4000)
    }
  }

  async function applyResolution(w: number, h: number) {
    resW = w
    resH = h
    updateDisplay({ resolutionWidth: w, resolutionHeight: h })
    try {
      await adb.setResolution(w, h)
    } catch (e) {
      showToast(`Resolution failed: ${e instanceof Error ? e.message : e}`, 'error', 4000)
    }
  }

  async function resetDefaults() {
    try {
      await adb.clearAllSettings()
      showToast('Settings reset', 'success')
    } catch (e) {
      showToast(`Reset failed: ${e instanceof Error ? e.message : e}`, 'error', 4000)
    }
    updateDisplay({
      resolutionWidth: 1832,
      resolutionHeight: 1920,
      refreshRate: 90,
      cpuLevel: 3,
      gpuLevel: 3,
      ffrLevel: 2,
      cpuDynamic: true,
      gpuDynamic: true,
      ffrDynamic: false,
    })
  }

  function saveGameProfile(packageName: string) {
    const profile: GameProfile = {
      id: crypto.randomUUID(),
      name: packageName.split('.').pop() || packageName,
      packageName,
      display: { ...display },
      isDefault: false,
    }
    addProfile(profile)
    appPickerOpen = false
    profileSection = 'list'
  }

  function applyAndLaunch(profile: GameProfile) {
    applyDisplayToDevice(profile.display)
    adb.launchApp(profile.packageName)
  }

  function savePreset() {
    const name = prompt('Preset name:')
    if (!name) return
    presets = [...presets, { id: crypto.randomUUID(), name, settings: { ...display } }]
    persistence.savePresets(presets)
  }

  function loadPreset(preset: persistence.DisplayPreset) {
    applyDisplayToDevice(preset.settings)
    showPresetList = false
  }

  onMount(async () => {
    await refresh()
    resW = display.resolutionWidth
    resH = display.resolutionHeight
    // Re-apply persisted settings to device on startup
    applyDisplayToDevice(display)
  })
</script>

<div class="tune">
  <!-- Zone A: The Cockpit — above the fold, zero scroll -->

  <Card>
    <LevelPicker
      label="CPU Level"
      bind:value={display.cpuLevel}
      bind:dynamic={display.cpuDynamic}
      max={5}
      color="var(--accent-seafoam)"
      onchange={(v, d) => applySetting(() => adb.setCpuLevel(v, d))}
    />
    <div class="divider"></div>
    <LevelPicker
      label="GPU Level"
      bind:value={display.gpuLevel}
      bind:dynamic={display.gpuDynamic}
      max={5}
      color="var(--accent-grape)"
      onchange={(v, d) => applySetting(() => adb.setGpuLevel(v, d))}
    />
    <div class="divider"></div>
    <LevelPicker
      label="FFR Level"
      bind:value={display.ffrLevel}
      bind:dynamic={display.ffrDynamic}
      max={4}
      color="var(--accent-teal)"
      onchange={(v, d) => applySetting(() => adb.setFfrLevel(v, d))}
    />
  </Card>

  <Card>
    <FrequencyPicker
      bind:value={display.refreshRate}
      options={[60, 72, 90, 120]}
      onchange={(hz) => applySetting(() => adb.setRefreshRate(hz))}
    />
  </Card>

  <!-- Zone B: Deliberate adjustments — scroll to reach -->

  <div class="zone-divider"></div>

  <Card title="Resolution">
    <div class="res-display">
      <div class="res-value">
        <span class="mono">{resW}</span>
        <span class="res-x">&times;</span>
        <span class="mono">{resH}</span>
      </div>
      <span class="res-ratio">{activePreset ?? 'Custom'}</span>
    </div>
    <div class="res-presets">
      {#each RESOLUTIONS as res}
        <button
          class="res-preset-btn"
          class:active={activePreset === res.label}
          onclick={() => applyResolution(res.w, res.h)}
        >
          <span class="res-preset-label">{res.label}</span>
          <span class="res-preset-dims mono">{res.w} &times; {res.h}</span>
        </button>
      {/each}
      <button
        class="res-preset-btn"
        class:active={showCustomRes && !activePreset}
        onclick={() => showCustomRes = !showCustomRes}
      >
        <span class="res-preset-label">Custom</span>
        <span class="res-preset-dims mono">{showCustomRes ? '▲' : '▼'}</span>
      </button>
    </div>
    {#if showCustomRes}
      <div class="res-custom">
        <Slider bind:value={resW} min={512} max={4096} step={32} label="Width" unit="px" />
        <Slider bind:value={resH} min={512} max={4096} step={32} label="Height" unit="px" />
        <Button variant="primary" onclick={() => applyResolution(resW, resH)}>Apply Custom</Button>
      </div>
    {/if}
  </Card>

  <Card title="Game Profiles">
    <div class="profile-tabs">
      <button class="ptab" class:active={profileSection === 'list'} onclick={() => profileSection = 'list'}>
        Saved Profiles
      </button>
      <button class="ptab" class:active={profileSection === 'save'} onclick={() => profileSection = 'save'}>
        Save Current
      </button>
    </div>
    {#if profileSection === 'list'}
      {#if profiles.length === 0}
        <p class="empty">No game profiles saved yet. Configure your display settings above, then save them for a specific game.</p>
      {:else}
        <div class="profile-list">
          {#each profiles as profile}
            <div class="profile-item">
              <div class="profile-info">
                <span class="profile-name">{profile.name}</span>
                <span class="profile-meta mono">
                  {profile.display.resolutionWidth}x{profile.display.resolutionHeight} @ {profile.display.refreshRate}Hz
                </span>
              </div>
              <div class="profile-actions">
                {#if profile.isDefault}
                  <span class="badge">Default</span>
                {/if}
                <Button size="sm" onclick={() => applyAndLaunch(profile)}>Run</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="save-hint">Current settings will be saved as a profile for the game you select.</p>
      <Button variant="primary" onclick={() => appPickerOpen = true}>Select Game & Save</Button>
    {/if}
  </Card>
  <AppPicker bind:open={appPickerOpen} title="Select Game" onselect={saveGameProfile} />

  <Card title="Presets & Reset">
    <div class="reset-actions">
      <Button onclick={savePreset}>Save as Preset</Button>
      <Button onclick={() => showPresetList = !showPresetList}>
        {showPresetList ? 'Hide Presets' : 'Load Preset'}
      </Button>
      {#if showPresetList && presets.length > 0}
        <div class="preset-list">
          {#each presets as preset}
            <button class="preset-item" onclick={() => loadPreset(preset)}>
              <span class="preset-name">{preset.name}</span>
              <span class="preset-detail mono">
                {preset.settings.resolutionWidth}x{preset.settings.resolutionHeight} @ {preset.settings.refreshRate}Hz
              </span>
            </button>
          {/each}
        </div>
      {:else if showPresetList}
        <p class="empty">No presets saved yet.</p>
      {/if}
      <Button variant="danger" onclick={resetDefaults}>Reset All to Default</Button>
    </div>
  </Card>

  <div class="refresh-row">
    <Button variant="ghost" onclick={refresh} disabled={refreshing}>
      {refreshing ? 'Refreshing...' : 'Refresh Device'}
    </Button>
  </div>
</div>

<style>
  .tune {
    padding: 0 16px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .divider {
    height: 1px;
    background: var(--border-subtle);
    margin: 8px 0;
  }

  .zone-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  /* Resolution */
  .res-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
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
  }

  .res-presets {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .res-preset-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    background: var(--surface-elevated);
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .res-preset-btn:last-child {
    border-bottom: none;
  }

  .res-preset-btn:hover {
    background: var(--surface-hover);
  }

  .res-preset-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 10px var(--primary-glow);
  }

  .res-preset-label {
    font-size: 14px;
    font-weight: 600;
  }

  .res-preset-dims {
    font-size: 13px;
    opacity: 0.7;
  }

  .res-custom {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* Profiles */
  .profile-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 14px;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .ptab {
    flex: 1;
    height: 40px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .ptab:last-child {
    border-right: none;
  }

  .ptab.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .empty {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .profile-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .profile-name {
    font-size: 15px;
    font-weight: 500;
  }

  .profile-meta {
    font-size: 12px;
    color: var(--text-muted);
  }

  .profile-actions {
    display: flex;
    align-items: center;
    gap: 8px;
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

  .save-hint {
    font-size: 14px;
    color: var(--text-muted);
    margin-bottom: 14px;
  }

  /* Presets */
  .reset-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preset-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .preset-item:hover {
    background: var(--surface-hover);
  }

  .preset-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .preset-detail {
    font-size: 12px;
    color: var(--text-muted);
  }

  .refresh-row {
    display: flex;
    justify-content: center;
  }
</style>
