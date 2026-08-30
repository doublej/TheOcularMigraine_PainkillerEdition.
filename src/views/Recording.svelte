<script module lang="ts">
  type Section = 'settings' | 'profiles'

  // Module scope on purpose: App.svelte swaps views with {#if}, so an instance-level
  // section would silently reset every time the user bounces off to Tune and back.
  let lastSection: Section = 'settings'
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import Slider from '../lib/components/ui/Slider.svelte'
  import {
    getDevice,
    getRecording,
    updateRecording,
    mergeRecording,
    isDemoMode,
    getServerConnected,
    refreshConnectionState,
    getAbilities,
    getPrivilege,
    type RecordingSettings,
  } from '../lib/stores/device.svelte'
  import { whyNot } from '../lib/bridge/capabilities'
  import { showToast } from '../lib/stores/toast.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'

  /** The five capture settings this screen writes — each one is device state only once read back. */
  const CAPTURE_FIELDS = ['size', 'fps', 'bitrate', 'eye', 'crop'] as const
  type CaptureField = (typeof CAPTURE_FIELDS)[number]

  // Reverse of the bridge's eyeMap: the prop holds the code, not the name.
  const eyeByCode = ['left', 'right', 'both'] as const

  // Quest Home and the system UI are not a VR app — with one of these in front nothing is captured.
  const SHELL_PACKAGES = ['com.oculus.shellenv', 'com.oculus.vrshell', 'com.oculus.systemux']

  const rec = $derived(getRecording())
  const device = $derived(getDevice())

  let activeSection = $state<Section>(lastSection)
  let isRecording = $state(false)
  /** False when the headset could not be asked — never assert "idle" on a failed read. */
  let stateKnown = $state(false)
  let busy = $state(false)
  /** Every control here writes a capture prop, so a route that cannot write them offers none of them. */
  const can = $derived(getAbilities())
  /** Only set when this screen started the capture; a capture found already running has no known start. */
  let startedAt = $state<number | null>(null)
  let elapsed = $state(0)
  /** Focused package as the headset reported it. '' = nothing focused, null = never read or the read failed. */
  let foregroundPkg = $state<string | null>(null)
  let checkingApp = $state(false)
  /** Capture props the headset holds no value for — what is shown for those is this app's draft. */
  let captureUnset = $state<CaptureField[]>([...CAPTURE_FIELDS])

  let showCustomTrim = $state(false)
  let naming = $state(false)
  let profileName = $state('')
  let expandedProfile = $state('')
  let confirmDelete = $state('')
  // Merged on load: a profile saved by an older version can be missing fovCrop entirely.
  let recProfiles = $state(
    persistence.loadRecordingProfiles().map(p => ({ ...p, settings: mergeRecording(p.settings) })),
  )

  const sizePresets = [
    { label: '720p', w: 1280, h: 720 },
    { label: '1080p', w: 1920, h: 1080 },
    { label: 'Vertical', w: 1080, h: 1920 },
  ]

  // The capture encoder honours a much smaller set than the display refresh rates.
  const fpsOptions = [30, 60]

  const bitrateOptions = [
    { label: 'Low', kbps: 10000 },
    { label: 'Medium', kbps: 20000 },
    { label: 'High', kbps: 30000 },
    { label: 'Max', kbps: 40000 },
  ]

  const eyeOptions = [
    { value: 'left', label: 'Left eye', hint: 'normal video' },
    { value: 'both', label: 'Both eyes', hint: 'side-by-side' },
    { value: 'right', label: 'Right eye', hint: 'normal video' },
  ] as const

  // Percent, like every crop value in the UI — the bridge divides by 100 for the prop.
  const EDGE_TRIM = { up: 10, down: 10, inward: 8, outward: 8 }
  const NO_TRIM = { up: 0, down: 0, inward: 0, outward: 0 }

  const trimmed = $derived(rec.fovCrop.up > 0 || rec.fovCrop.down > 0 || rec.fovCrop.inward > 0 || rec.fovCrop.outward > 0)
  const isEdgeTrim = $derived(
    rec.fovCrop.up === EDGE_TRIM.up && rec.fovCrop.down === EDGE_TRIM.down &&
    rec.fovCrop.inward === EDGE_TRIM.inward && rec.fovCrop.outward === EDGE_TRIM.outward,
  )
  const mbps = $derived(rec.bitrate / 1000)
  const estimatedMb = $derived(Math.round((mbps * elapsed) / 8))

  /** A VR app has focus, so frames are actually being written — the prop alone only arms the capture. */
  const appInFront = $derived(!!foregroundPkg && !SHELL_PACKAGES.includes(foregroundPkg))
  const capturing = $derived(isRecording && appInFront)

  // Everything this line claims has been read back: no elapsed time for a capture we have not seen
  // start, and no '?' from a storage read that failed.
  const runningLine = $derived([
    capturing ? 'Recording' : 'Capture is on',
    capturing && startedAt !== null ? formatElapsed(elapsed) : '',
    capturing && startedAt !== null ? `about ${estimatedMb} MB` : '',
    device.freeSpace && device.freeSpace !== '?' ? `${device.freeSpace} free` : '',
  ].filter(Boolean).join(' · '))

  // Nothing persists the crop sliders: Slider has no change callback, so bind: mutates
  // the store without ever reaching saveRecordingSettings.
  $effect(() => { persistence.saveRecordingSettings($state.snapshot(rec)) })

  $effect(() => {
    if (!capturing || startedAt === null) return
    const from = startedAt
    elapsed = Math.floor((Date.now() - from) / 1000)
    const id = setInterval(() => { elapsed = Math.floor((Date.now() - from) / 1000) }, 1000)
    return () => clearInterval(id)
  })

  // The arm expires on its own and dies with the view, so a stray double-tap cannot walk through it.
  $effect(() => {
    if (!confirmDelete) return
    const id = setTimeout(() => { confirmDelete = '' }, 5000)
    return () => clearTimeout(id)
  })

  onMount(() => { void readRecordingState() })

  /** The props are the only truth: a capture can be started from inside VR or by an earlier session. */
  async function readRecordingState() {
    try {
      // One `getprop` carries the capture state and all five settings, so this is a single round trip.
      const props = await adb.getCurrentOculusProps()
      // A fixture answer is not a headset answer: nothing read in demo mode may be shown as device state.
      if (adb.isFixtureRead()) {
        stateKnown = false
        foregroundPkg = null
        return
      }
      isRecording = props['debug.oculus.enableVideoCapture'] === '1'
      adoptCaptureProps(props)
      stateKnown = true
    } catch {
      // Reported on the button rather than as a toast: this runs on every visit to the tab.
      stateKnown = false
    }
    // Only asked when it is load-bearing: it is what tells a running capture apart from an armed one.
    if (isRecording) await readForeground()
    else foregroundPkg = null
  }

  /** setprop takes anything, so a prop can hold a value the encoder never used: out of domain is unset. */
  function readNumber(props: Record<string, string>, prop: string, min: number, max: number): number | null {
    const raw = props[`debug.oculus.${prop}`]
    const n = Number(raw)
    return raw && Number.isFinite(n) && n >= min && n <= max ? n : null
  }

  /** What the headset will record is what its props say; the saved settings are only a draft until then. */
  function adoptCaptureProps(props: Record<string, string>) {
    const patch: Partial<RecordingSettings> = {}
    const unset: CaptureField[] = []
    const pct = (fraction: number) => Math.round(fraction * 100)

    const width = readNumber(props, 'capture.width', 256, 4096)
    const height = readNumber(props, 'capture.height', 256, 4096)
    if (width !== null && height !== null) { patch.width = width; patch.height = height } else unset.push('size')

    const fps = readNumber(props, 'capture.fps', 1, 120)
    if (fps !== null) patch.framerate = fps
    else unset.push('fps')

    // The prop is bits per second; the store keeps kbps.
    const bitrate = readNumber(props, 'capture.bitrate', 1_000_000, 200_000_000)
    if (bitrate !== null) patch.bitrate = bitrate / 1000
    else unset.push('bitrate')

    const eyeCode = readNumber(props, 'screenCaptureEye', 0, 2)
    const eye = eyeCode === null ? undefined : eyeByCode[eyeCode]
    if (eye) patch.eye = eye
    else unset.push('eye')

    // The props are 0.0-1.0 fractions, the UI is whole percent. A half-written crop is not a crop.
    const up = readNumber(props, 'fovCrop.up', 0, 1)
    const down = readNumber(props, 'fovCrop.down', 0, 1)
    const inward = readNumber(props, 'fovCrop.inward', 0, 1)
    const outward = readNumber(props, 'fovCrop.outward', 0, 1)
    if (up !== null && down !== null && inward !== null && outward !== null) {
      patch.fovCrop = { up: pct(up), down: pct(down), inward: pct(inward), outward: pct(outward) }
    } else unset.push('crop')

    updateRecording(patch)
    captureUnset = unset
  }

  /** dumpsys is refused to a plain app on-device, so a failed read is normal — it never means "idle". */
  async function readForeground() {
    try {
      const raw = await adb.shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'")
      foregroundPkg = adb.isFixtureRead() ? null : raw.match(/([A-Za-z][\w.]+)\/[\w.$]+/)?.[1] ?? ''
    } catch {
      foregroundPkg = null
    }
  }

  async function recheckForeground() {
    if (checkingApp) return
    checkingApp = true
    await readForeground()
    checkingApp = false
  }

  function describeSettings(s: RecordingSettings): string {
    const eye = { left: 'Left eye', right: 'Right eye', both: 'Both eyes' }[s.eye]
    const crop = s.fovCrop.up || s.fovCrop.down || s.fovCrop.inward || s.fovCrop.outward
    return `${s.width}x${s.height} · ${s.framerate} fps · ${s.bitrate / 1000} Mbps · ${eye}${crop ? ' · trimmed' : ''}`
  }

  function formatElapsed(seconds: number): string {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }

  function selectSection(section: Section) {
    activeSection = section
    lastSection = section
    // An arm must not survive leaving the row that owns it.
    confirmDelete = ''
    // This view owns the longest scroll in the app and the container is App's, not ours.
    document.dispatchEvent(new Event('tom:scrolltop'))
  }

  async function toggleRecording() {
    if (busy) return
    // Read the bridge's live state first: a mid-session drop must not be reported as a success.
    refreshConnectionState()
    if (isDemoMode() || !getServerConnected()) {
      showToast('Not connected — nothing was sent to the headset', 'error')
      return
    }
    const starting = !isRecording
    busy = true
    try {
      if (starting) {
        await adb.applyRecordingSettings(rec)
        await adb.startRecording()
      } else {
        await adb.stopRecording()
      }
      // setprop never errors on a bad value, so the prop is read back before claiming anything.
      await readRecordingState()
      if (isRecording === starting) {
        // The prop only arms the encoder: without a VR app in front there is nothing to time.
        startedAt = starting && appInFront ? Date.now() : null
        elapsed = 0
        if (!starting) showToast('Recording stopped', 'info')
        else if (appInFront) showToast('Recording started', 'success')
        else if (foregroundPkg === null) showToast('Capture enabled — could not check whether a VR app is open', 'info')
        else showToast('Capture enabled — recording starts when you open a VR app', 'info')
      } else {
        showToast(`The headset still reports capture ${starting ? 'off' : 'on'} — nothing changed`, 'error')
      }
    } catch (e) {
      showToast(`Recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error')
      await readRecordingState()
    } finally {
      busy = false
      refreshConnectionState()
    }
  }

  function applyTrim(on: boolean) {
    updateRecording({ fovCrop: { ...(on ? EDGE_TRIM : NO_TRIM) } })
  }

  function startNaming() {
    profileName = `${rec.width}x${rec.height} ${rec.framerate}fps`
    naming = true
  }

  function saveRecProfile() {
    const name = profileName.trim()
    if (!name) {
      showToast('Give the profile a name first', 'error')
      return
    }
    if (recProfiles.some(p => p.name === name)) {
      showToast(`A profile called "${name}" already exists`, 'error')
      return
    }
    recProfiles = [...recProfiles, { id: String(Date.now()), name, settings: $state.snapshot(rec) }]
    persistence.saveRecordingProfiles(recProfiles)
    naming = false
    showToast(`Saved "${name}"`, 'success')
  }

  function loadRecProfile(profile: persistence.RecordingProfile) {
    // Mid-capture the settings panel is inert and applyRecordingSettings is never re-run, so a load
    // would change nothing on the headset while toasting a success and navigating to a dead panel.
    if (isRecording || busy) {
      showToast('Stop recording first — capture settings cannot change mid-capture', 'error')
      return
    }
    // Snapshot first: without it the saved profile and live settings share one fovCrop object.
    updateRecording(mergeRecording($state.snapshot(profile.settings)))
    expandedProfile = ''
    selectSection('settings')
    showToast(`Loaded "${profile.name}" — ${describeSettings(profile.settings)}`, 'success')
  }

  function deleteRecProfile(id: string) {
    recProfiles = recProfiles.filter(p => p.id !== id)
    persistence.saveRecordingProfiles(recProfiles)
    confirmDelete = ''
    expandedProfile = ''
    showToast('Profile deleted', 'info')
  }

  function toggleProfile(id: string) {
    expandedProfile = expandedProfile === id ? '' : id
    confirmDelete = ''
  }
</script>

<div class="rec">
  <div class="section-tabs">
    <button class="stab" class:active={activeSection === 'settings'} onclick={() => selectSection('settings')}>
      Settings
    </button>
    <button class="stab" class:active={activeSection === 'profiles'} onclick={() => selectSection('profiles')}>
      Profiles
    </button>
  </div>

  {#if !can.writeProps}
    <p class="rec-warn">
      Nothing on this screen can change the headset right now. {whyNot('writeProps', getPrivilege())}
    </p>
  {/if}

  <!-- Outside the section branches: this is the only stop control in the app. -->
  <div class="record-control">
    <button class="record-btn" class:recording={isRecording} class:capturing disabled={busy || !can.writeProps} onclick={toggleRecording}>
      <span class="rec-dot"></span>
      {#if busy}
        {isRecording ? 'Stopping…' : 'Starting…'}
      {:else}
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      {/if}
    </button>
    {#if isRecording}
      <p class="rec-status">{runningLine}</p>
      <!-- Nothing here may claim a running capture the headset has not shown us. -->
      {#if !capturing}
        <p class="rec-warn">
          {#if foregroundPkg === null}
            Could not check what is open in the headset, so this is not a confirmed recording.
          {:else if foregroundPkg}
            {foregroundPkg} is in front — recording starts when you open a VR app.
          {:else}
            No app is in front — recording starts when you open a VR app.
          {/if}
        </p>
        <button class="disclosure" disabled={checkingApp} onclick={recheckForeground}>
          {checkingApp ? 'Checking…' : 'Check again'}
        </button>
      {/if}
    {:else}
      <p class="rec-status">Will record: {describeSettings(rec)}</p>
      <p class="rec-note">Capture only runs while a VR app is open in the headset. The settings below are applied when you start.</p>
    {/if}
    <!-- Outside both branches: a failed read leaves `isRecording` stale in either direction. -->
    {#if !stateKnown}
      <p class="rec-warn">
        Recording state unknown — {isDemoMode() ? 'no headset is attached' : 'the headset did not answer'}.
        Nothing above is confirmed.
      </p>
    {/if}
  </div>

{#snippet unsetTag(field: CaptureField)}
  {#if captureUnset.includes(field)}
    <span class="unset-tag">not set on the headset</span>
  {/if}
{/snippet}

  {#if activeSection === 'settings'}
    {#if isRecording}
      <p class="locked-note">Stop recording to change capture settings.</p>
    {/if}

    <!-- Rule 5: the props a start would overwrite stay locked for as long as that write runs. -->
    <div class="settings" class:locked={isRecording || busy || !can.writeProps} inert={isRecording || busy || !can.writeProps}>
      <Card title="Video size">
        {@render unsetTag('size')}
        <div class="presets">
          {#each sizePresets as preset}
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
      </Card>

      <Card title="Quality">
        <div class="block">
          <span class="block-label">Capture frame rate</span>
          {@render unsetTag('fps')}
          <div class="seg">
            {#each fpsOptions as fps}
              <button class="seg-btn" class:active={rec.framerate === fps} onclick={() => updateRecording({ framerate: fps })}>
                <span class="seg-name">{fps} fps</span>
              </button>
            {/each}
          </div>
          {#if !fpsOptions.includes(rec.framerate)}
            <p class="warn">{rec.framerate} fps is set, but capture only records at 30 or 60 fps — pick one above.</p>
          {/if}
        </div>

        <div class="block">
          <span class="block-label">Bitrate</span>
          {@render unsetTag('bitrate')}
          <div class="seg">
            {#each bitrateOptions as option}
              <button class="seg-btn" class:active={rec.bitrate === option.kbps} onclick={() => updateRecording({ bitrate: option.kbps })}>
                <span class="seg-name">{option.label}</span>
                <span class="seg-sub">{option.kbps / 1000} Mbps</span>
              </button>
            {/each}
          </div>
          <p class="hint">{mbps} Mbps — about {Math.round(mbps * 7.5)} MB per minute.</p>
        </div>
      </Card>

      <Card title="Camera position">
        {@render unsetTag('eye')}
        <div class="seg">
          {#each eyeOptions as option}
            <button class="seg-btn tall" class:active={rec.eye === option.value} onclick={() => updateRecording({ eye: option.value })}>
              <span class="seg-name">{option.label}</span>
              <span class="seg-sub">{option.hint}</span>
            </button>
          {/each}
        </div>
        <p class="hint">Side-by-side records both eyes into one frame; it needs 3D processing before it plays back as stereo.</p>
      </Card>

      <Card title="Trim the recorded picture">
        <p class="hint lead">Cuts the dark warped border off your video. Does not change what you see in the headset.</p>
        {@render unsetTag('crop')}
        <div class="seg">
          <button class="seg-btn" class:active={!trimmed} onclick={() => applyTrim(false)}>
            <span class="seg-name">No trim</span>
          </button>
          <button class="seg-btn" class:active={isEdgeTrim} onclick={() => applyTrim(true)}>
            <span class="seg-name">Trim edges (10%)</span>
          </button>
        </div>
        <button class="disclosure" onclick={() => showCustomTrim = !showCustomTrim}>
          {showCustomTrim ? 'Hide per-edge trim' : 'Set each edge yourself'}
        </button>
        {#if showCustomTrim}
          <Slider bind:value={rec.fovCrop.up} min={0} max={40} label="Trim top" unit="%" color="var(--accent-grape)" />
          <Slider bind:value={rec.fovCrop.down} min={0} max={40} label="Trim bottom" unit="%" color="var(--accent-grape)" />
          <Slider bind:value={rec.fovCrop.inward} min={0} max={40} label="Trim nose side" unit="%" color="var(--accent-grape)" />
          <Slider bind:value={rec.fovCrop.outward} min={0} max={40} label="Trim outer side" unit="%" color="var(--accent-grape)" />
        {/if}
      </Card>
    </div>

  {:else}
    <Card title="Profiles">
      <p class="hint lead">
        A profile is a set of capture settings you can load back later. It is not tied to a game —
        Game Profiles on the Tune tab do that.
      </p>
      {#if isRecording}
        <p class="locked-note">Stop recording to load a profile — capture settings are locked mid-capture.</p>
      {/if}
      <div class="profile-actions">
        {#if naming}
          <div class="name-row">
            <input class="name-input" bind:value={profileName} placeholder="Profile name" aria-label="Profile name" />
            <Button size="sm" variant="primary" onclick={saveRecProfile}>Save</Button>
            <Button size="sm" onclick={() => naming = false}>Cancel</Button>
          </div>
        {:else}
          <Button variant="primary" onclick={startNaming}>Save current settings</Button>
        {/if}

        {#if recProfiles.length === 0}
          <p class="empty">No profiles saved yet.</p>
        {:else}
          <div class="rec-profile-list">
            {#each recProfiles as profile (profile.id)}
              <div class="rec-profile-item">
                <button class="rp-head" onclick={() => toggleProfile(profile.id)}>
                  <span class="rp-name">{profile.name}</span>
                  <span class="rp-detail">{describeSettings(profile.settings)}</span>
                </button>
                {#if expandedProfile === profile.id}
                  <div class="rp-actions">
                    <Button size="sm" variant="primary" disabled={isRecording || busy || !can.writeProps} onclick={() => loadRecProfile(profile)}>
                      Load these settings
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onclick={() => confirmDelete === profile.id ? deleteRecProfile(profile.id) : (confirmDelete = profile.id)}
                    >
                      {confirmDelete === profile.id ? 'Tap again to delete' : 'Delete'}
                    </Button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
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

  /* Underlined, not filled: the bottom TabBar owns the filled-glow active treatment. */
  .section-tabs {
    display: flex;
    gap: 20px;
    border-bottom: 1px solid var(--border);
  }

  .stab {
    height: 44px;
    padding: 0 2px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .stab.active {
    color: var(--text);
    border-bottom-color: var(--primary);
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settings.locked {
    opacity: 0.45;
  }

  .locked-note {
    font-size: 13px;
    color: var(--warning);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
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
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .block {
    padding: 6px 0;
  }

  .block-label {
    display: block;
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 10px;
  }

  .seg {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .seg-btn {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 6px 4px;
    background: var(--surface-elevated);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .seg-btn.tall {
    min-height: 56px;
  }

  .seg-btn:last-child {
    border-right: none;
  }

  .seg-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .seg-name {
    font-size: 14px;
    font-weight: 600;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .seg-sub {
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.75;
  }

  .disclosure {
    width: 100%;
    min-height: 44px;
    margin-top: 8px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .disclosure:disabled {
    opacity: 0.5;
  }

  .unset-tag {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .record-control {
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  .record-btn:disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .record-btn.recording {
    border-color: var(--danger);
    background: rgba(250, 56, 62, 0.06);
    color: var(--danger);
    box-shadow: 0 0 20px rgba(250, 56, 62, 0.1);
  }

  /* Filled red always means recording — an idle dot is an empty outline. */
  .rec-dot {
    width: 12px;
    height: 12px;
    background: transparent;
    border: 2px solid var(--text-muted);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .record-btn.recording .rec-dot {
    background: var(--danger);
    border-color: var(--danger);
  }

  /* Only a capture we have seen a VR app for gets to pulse; an armed one is a still red dot. */
  .record-btn.capturing .rec-dot {
    animation: pulse 1.5s ease infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  .rec-status {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .rec-warn, .warn {
    font-size: 13px;
    color: var(--warning);
    line-height: 1.45;
  }

  .warn {
    margin-top: 8px;
  }

  .rec-note {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .hint, .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 8px;
  }

  .hint.lead {
    margin-top: 0;
    margin-bottom: 12px;
  }

  .profile-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .name-row {
    display: flex;
    gap: 8px;
  }

  .name-input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 14px;
    outline: none;
  }

  .name-input:focus {
    border-color: var(--primary);
  }

  .rec-profile-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 280px;
    overflow-y: auto;
  }

  .rec-profile-item {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .rp-head {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
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

  .rp-actions {
    display: flex;
    gap: 8px;
    padding: 0 14px 12px;
  }
</style>
