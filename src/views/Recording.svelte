<script lang="ts">
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import Slider from '../lib/components/ui/Slider.svelte'
  import Toggle from '../lib/components/ui/Toggle.svelte'
  import { getRecording, updateRecording } from '../lib/stores/device.svelte'
  import { showToast } from '../lib/stores/toast.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'

  const rec = $derived(getRecording())

  let isRecording = $state(false)
  let activeSection: 'settings' | 'profiles' | 'video' = $state('settings')
  let showProfileList = $state(false)
  let recProfiles = $state(persistence.loadRecordingProfiles())

  const resPresets = [
    { label: 'FHD', w: 1920, h: 1080 },
    { label: '4K', w: 3840, h: 2160 },
    { label: 'HD', w: 1280, h: 720 },
    { label: 'Vertical', w: 1080, h: 1920 },
  ]

  const fpsOptions = [60, 72, 90, 120]

  async function toggleRecording() {
    try {
      if (isRecording) {
        await adb.stopRecording()
        isRecording = false
        showToast('Recording stopped', 'info')
      } else {
        await adb.applyRecordingSettings(rec)
        await adb.startRecording()
        isRecording = true
        showToast('Recording started', 'success')
      }
    } catch (e) {
      showToast(`Recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error', 4000)
    }
  }

  function setOptimalCrop() {
    updateRecording({ fovCrop: { up: 10, down: 10, inward: 8, outward: 8 } })
  }

  function saveRecProfile() {
    const name = prompt('Profile name:')
    if (!name) return
    recProfiles = [...recProfiles, { id: crypto.randomUUID(), name, settings: { ...rec } }]
    persistence.saveRecordingProfiles(recProfiles)
  }

  function loadRecProfile(profile: persistence.RecordingProfile) {
    updateRecording(profile.settings)
    showProfileList = false
  }
</script>

<div class="rec">
  <div class="section-tabs">
    <button class="stab" class:active={activeSection === 'settings'} onclick={() => activeSection = 'settings'}>
      Settings
    </button>
    <button class="stab" class:active={activeSection === 'profiles'} onclick={() => activeSection = 'profiles'}>
      Profiles
    </button>
    <button class="stab" class:active={activeSection === 'video'} onclick={() => activeSection = 'video'}>
      Video
    </button>
  </div>

  {#if activeSection === 'settings'}
    <Card title="Resolution">
      <div class="presets">
        {#each resPresets as preset}
          <button
            class="preset-btn"
            class:active={rec.width === preset.w && rec.height === preset.h}
            onclick={() => updateRecording({ width: preset.w, height: preset.h })}
          >
            <span class="preset-label">{preset.label}</span>
            <span class="preset-res">{preset.w}x{preset.h}</span>
          </button>
        {/each}
      </div>
      <Slider
        bind:value={rec.width}
        min={640}
        max={3840}
        step={2}
        label="Width"
        unit="px"
      />
      <Slider
        bind:value={rec.height}
        min={360}
        max={2160}
        step={2}
        label="Height"
        unit="px"
      />
    </Card>

    <Card title="Quality">
      <Slider
        bind:value={rec.bitrate}
        min={5000}
        max={50000}
        step={1000}
        label="Bitrate"
        unit=" kbps"
        color="var(--accent-amber)"
      />
      <div class="fps-picker">
        <span class="fps-label">Frame Rate</span>
        <div class="fps-options">
          {#each fpsOptions as fps}
            <button
              class="fps-btn"
              class:active={rec.framerate === fps}
              onclick={() => updateRecording({ framerate: fps })}
            >
              {fps}
            </button>
          {/each}
        </div>
      </div>
    </Card>

    <Card title="Recording Eye">
      <div class="eye-picker">
        <button class="eye-btn" class:active={rec.eye === 'left'} onclick={() => updateRecording({ eye: 'left' })}>
          Left
        </button>
        <button class="eye-btn" class:active={rec.eye === 'both'} onclick={() => updateRecording({ eye: 'both' })}>
          Both (3D)
        </button>
        <button class="eye-btn" class:active={rec.eye === 'right'} onclick={() => updateRecording({ eye: 'right' })}>
          Right
        </button>
      </div>
    </Card>

    <Card title="FOV Crop">
      <div class="crop-grid">
        <Slider bind:value={rec.fovCrop.up} min={0} max={100} label="Up" color="var(--accent-grape)" />
        <Slider bind:value={rec.fovCrop.down} min={0} max={100} label="Down" color="var(--accent-grape)" />
        <Slider bind:value={rec.fovCrop.inward} min={0} max={100} label="Inward" color="var(--accent-grape)" />
        <Slider bind:value={rec.fovCrop.outward} min={0} max={100} label="Outward" color="var(--accent-grape)" />
      </div>
      <div class="crop-actions">
        <Button size="sm" onclick={setOptimalCrop}>Optimal Crop</Button>
        <Button size="sm" variant="ghost" onclick={() => updateRecording({ fovCrop: { up: 0, down: 0, inward: 0, outward: 0 } })}>
          Remove Crop
        </Button>
      </div>
    </Card>

    <Card title="Advanced">
      <Toggle
        bind:checked={rec.adaclocks}
        label="Adaptive clocking"
        description="Adjust GPU/CPU clocks during capture"
      />
      <Slider
        bind:value={rec.swapInterval}
        min={1}
        max={4}
        step={1}
        label="Swap Interval"
      />
    </Card>

    <div class="record-control">
      <button
        class="record-btn"
        class:recording={isRecording}
        onclick={toggleRecording}
      >
        <span class="rec-dot"></span>
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      </button>
    </div>

  {:else if activeSection === 'profiles'}
    <Card title="Profiles">
      <p class="hint">Save and recall recording configurations per game.</p>
      <div class="profile-actions">
        <Button variant="primary" onclick={saveRecProfile}>Save Current</Button>
        <Button onclick={() => showProfileList = !showProfileList}>
          {showProfileList ? 'Hide Profiles' : 'Load Profile'}
        </Button>
        {#if showProfileList && recProfiles.length > 0}
          <div class="rec-profile-list">
            {#each recProfiles as profile}
              <button class="rec-profile-item" onclick={() => loadRecProfile(profile)}>
                <span class="rp-name">{profile.name}</span>
                <span class="rp-detail">{profile.settings.width}x{profile.settings.height} @ {profile.settings.framerate}fps</span>
              </button>
            {/each}
          </div>
        {:else if showProfileList}
          <p class="empty">No profiles saved yet.</p>
        {/if}
      </div>
    </Card>

  {:else if activeSection === 'video'}
    <Card title="Video Processing">
      <p class="section-desc">Process recorded videos with audio sync fixes, trimming, and 3D metadata injection.</p>
      <div class="video-actions">
        <button class="video-action disabled" disabled>
          <span class="va-icon">3D</span>
          <div class="va-text">
            <span class="va-title">Inject 3D Metadata</span>
            <span class="va-desc">Requires ffmpeg — not available</span>
          </div>
        </button>
        <button class="video-action disabled" disabled>
          <span class="va-icon">2D</span>
          <div class="va-text">
            <span class="va-title">Process 2D Video</span>
            <span class="va-desc">Requires ffmpeg — not available</span>
          </div>
        </button>
      </div>
    </Card>
  {/if}
</div>

<style>
  .rec {
    padding: 0 16px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-tabs {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .stab {
    flex: 1;
    height: 44px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .stab:last-child {
    border-right: none;
  }

  .stab.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 12px 4px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .preset-btn.active {
    border-color: var(--primary);
    background: var(--primary-glow);
  }

  .preset-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .preset-btn.active .preset-label {
    color: var(--primary);
  }

  .preset-res {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .fps-picker {
    padding: 10px 0;
  }

  .fps-label {
    display: block;
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 10px;
  }

  .fps-options {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .fps-btn {
    flex: 1;
    height: 44px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .fps-btn:last-child {
    border-right: none;
  }

  .fps-btn.active {
    background: color-mix(in srgb, var(--accent-amber) 12%, transparent);
    color: var(--accent-amber);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-amber) 20%, transparent);
  }

  .eye-picker {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .eye-btn {
    flex: 1;
    height: 48px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .eye-btn:last-child {
    border-right: none;
  }

  .eye-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .crop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
  }

  .crop-actions {
    margin-top: 6px;
    display: flex;
    gap: 8px;
  }

  .record-control {
    padding: 4px 0;
  }

  .record-btn {
    width: 100%;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    color: var(--text);
    font-size: 17px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration) var(--ease-out);
  }

  .record-btn:hover {
    border-color: var(--danger);
  }

  .record-btn:active {
    transform: scale(0.98);
  }

  .record-btn.recording {
    border-color: var(--danger);
    background: rgba(250, 56, 62, 0.06);
    color: var(--danger);
    box-shadow: 0 0 20px rgba(250, 56, 62, 0.1);
  }

  .rec-dot {
    width: 12px;
    height: 12px;
    background: var(--danger);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .record-btn.recording .rec-dot {
    animation: pulse 1.5s ease infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  .hint, .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .profile-actions {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-desc {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.6;
    margin-bottom: 14px;
  }

  .video-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .video-action {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    text-align: left;
  }

  .video-action:hover {
    background: var(--surface-hover);
  }

  .va-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    background: var(--primary-glow);
    border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
    color: var(--primary);
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .va-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .va-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
  }

  .va-desc {
    font-size: 13px;
    color: var(--text-muted);
  }

  .video-action.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .rec-profile-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rec-profile-item {
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

  .rec-profile-item:hover {
    background: var(--surface-hover);
  }

  .rp-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .rp-detail {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
