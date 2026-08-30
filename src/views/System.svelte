<script lang="ts">
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import Toggle from '../lib/components/ui/Toggle.svelte'
  import AppPicker from '../lib/components/ui/AppPicker.svelte'
  import { getDevice } from '../lib/stores/device.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'

  const device = $derived(getDevice())

  let activeSection: 'apps' | 'device' | 'console' | 'actions' = $state('apps')


  let kioskEnabled = $state(false)
  let kioskApp = $state(persistence.getKioskApp())
  let kioskPickerOpen = $state(false)

  let whitelistEnabled = $state(false)
  let blacklistEnabled = $state(false)
  let whitelist = $state(persistence.getWhitelist())
  let blacklist = $state(persistence.getBlacklist())
  let whitelistPickerOpen = $state(false)
  let blacklistPickerOpen = $state(false)

  let startupApp = $state(persistence.getStartupApp())
  let startupEnabled = $state(!!persistence.getStartupApp())
  let startupPickerOpen = $state(false)

  let apkPath = $state('')
  let installOutput = $state('')


  let shellInput = $state('')
  let consoleOutput = $state('')
  let scripts = $state(persistence.loadUserScripts())


  let detectionMethod = $state<'appusage' | 'logcat'>('appusage')

  const quickApps: Record<string, string> = {
    'File Manager': 'com.oculus.filemanager',
    'SideQuest': 'com.sidequest.wrapper',
    'F-Droid': 'org.fdroid.fdroid',
    'OVR Metrics': 'com.oculus.ovrmonitormetricsservice',
  }


  async function installApk() {
    if (!apkPath.trim()) return
    installOutput = 'Installing...'
    installOutput = await adb.installApk(apkPath.trim())
    apkPath = ''
  }

  function selectKioskApp(pkg: string) {
    kioskApp = pkg
    persistence.setKioskApp(pkg)
    kioskPickerOpen = false
  }

  async function toggleKiosk(enabled: boolean) {
    if (enabled && kioskApp) {
      await adb.setprop('persist.oculus.kiosk_mode', '1')
      await adb.setprop('persist.oculus.kiosk_app', kioskApp)
    } else {
      await adb.setprop('persist.oculus.kiosk_mode', '0')
    }
  }

  function selectStartupApp(pkg: string) {
    startupApp = pkg
    startupEnabled = true
    persistence.setStartupApp(pkg)
    startupPickerOpen = false
  }

  function clearStartupApp() {
    startupEnabled = false
    startupApp = ''
    persistence.setStartupApp('')
  }

  async function applyWhitelist() {
    persistence.setWhitelist(whitelist)
    const allPkgs = await adb.getInstalledPackages()
    const toDisable = allPkgs.filter(pkg => !whitelist.includes(pkg))
    await Promise.all(toDisable.map(pkg => adb.disablePackage(pkg)))
  }

  async function applyBlacklist() {
    persistence.setBlacklist(blacklist)
    await Promise.all(blacklist.map(pkg => adb.disablePackage(pkg)))
  }

  async function disableAll() {
    whitelistEnabled = false
    blacklistEnabled = false
    const allPkgs = await adb.getInstalledPackages()
    await Promise.all(allPkgs.map(pkg => adb.enablePackage(pkg)))
  }

  async function runCommand(input: string, clear: () => void) {
    if (!input.trim()) return
    consoleOutput = await adb.shell(input)
    clear()
  }

  function handleScriptClick(index: number) {
    const script = scripts[index]
    if (script) {
      adb.shell(script.command).then(out => consoleOutput = out || `Executed: ${script.command}`)
    } else {
      editScript(index)
    }
  }

  function editScript(index: number) {
    const name = prompt('Script name:')
    if (!name) return
    const command = prompt('Shell command:')
    if (!command) return
    scripts[index] = { slot: index, name, command }
    persistence.saveUserScripts(scripts)
  }


  async function saveSettings() {
    const props = await adb.getCurrentOculusProps()
    persistence.saveSettingsBackup(props)
    consoleOutput = `Saved ${Object.keys(props).length} settings to backup`
  }

  async function loadSettings() {
    const backup = persistence.loadSettingsBackup()
    if (!backup) { consoleOutput = 'No backup found'; return }
    for (const [key, value] of Object.entries(backup)) {
      await adb.setprop(key, value)
    }
    consoleOutput = `Restored ${Object.keys(backup).length} settings`
  }

  async function showCurrentSettings() {
    const props = await adb.getCurrentOculusProps()
    consoleOutput = Object.entries(props).map(([k, v]) => `${k} = ${v}`).join('\n') || 'No debug.oculus properties set'
  }
</script>

<div class="sys">
  <div class="section-tabs">
    <button class="stab" class:active={activeSection === 'apps'} onclick={() => activeSection = 'apps'}>
      Apps
    </button>
    <button class="stab" class:active={activeSection === 'device'} onclick={() => activeSection = 'device'}>
      Device
    </button>
    <button class="stab" class:active={activeSection === 'console'} onclick={() => activeSection = 'console'}>
      Console
    </button>
    <button class="stab" class:active={activeSection === 'actions'} onclick={() => activeSection = 'actions'}>
      Actions
    </button>
  </div>

  {#if activeSection === 'apps'}
    <Card title="Install APK">
      <p class="hint">Install an APK from the device filesystem.</p>
      <div class="install-row">
        <input
          type="text"
          class="text-input"
          placeholder="/sdcard/Download/app.apk"
          bind:value={apkPath}
          onkeydown={(e) => { if (e.key === 'Enter') installApk() }}
        />
        <Button size="sm" variant="primary" onclick={installApk}>Install</Button>
      </div>
      {#if installOutput}
        <pre class="output">{installOutput}</pre>
      {/if}
    </Card>

    <Card title="Kiosk Mode">
      <Toggle
        bind:checked={kioskEnabled}
        label="Lock to single app"
        description={kioskApp ? `App: ${kioskApp.split('.').pop()}` : 'Select an app first'}
        onchange={toggleKiosk}
      />
      {#if !kioskEnabled}
        <div class="btn-row">
          <Button onclick={() => kioskPickerOpen = true}>Select App</Button>
        </div>
      {:else}
        <Button variant="danger" onclick={() => { kioskEnabled = false; toggleKiosk(false) }}>Disable</Button>
      {/if}
    </Card>
    <AppPicker bind:open={kioskPickerOpen} title="Select Kiosk App" onselect={selectKioskApp} />

    <Card title="Startup App">
      <Toggle
        bind:checked={startupEnabled}
        label="Launch on boot"
        description={startupApp ? `App: ${startupApp.split('.').pop()}` : 'No app selected'}
        onchange={(checked) => { if (!checked) clearStartupApp() }}
      />
      <div class="btn-row">
        <Button onclick={() => startupPickerOpen = true} disabled={startupEnabled}>Select App</Button>
      </div>
    </Card>
    <AppPicker bind:open={startupPickerOpen} title="Select Startup App" onselect={selectStartupApp} />

    <Card title="Access Control">
      <Toggle
        bind:checked={whitelistEnabled}
        label="Allow only selected apps"
        description={whitelist.length ? `${whitelist.length} apps allowed` : 'No apps selected'}
        onchange={(on) => { if (on) { blacklistEnabled = false; applyWhitelist() } }}
      />
      <Toggle
        bind:checked={blacklistEnabled}
        label="Block selected apps"
        description={blacklist.length ? `${blacklist.length} apps blocked` : 'No apps selected'}
        onchange={(on) => { if (on) { whitelistEnabled = false; applyBlacklist() } }}
      />
      <div class="btn-row wrap">
        <Button size="sm" onclick={() => whitelistPickerOpen = true}>Edit Allowed</Button>
        <Button size="sm" onclick={() => blacklistPickerOpen = true}>Edit Blocked</Button>
        <Button size="sm" variant="danger" onclick={disableAll}>Remove All Restrictions</Button>
      </div>
    </Card>
    <AppPicker bind:open={whitelistPickerOpen} title="Select Allowed Apps" multiple bind:selected={whitelist} />
    <AppPicker bind:open={blacklistPickerOpen} title="Select Blocked Apps" multiple bind:selected={blacklist} />

    <Card title="Quick Launch">
      <p class="hint">Open common utility apps on the headset.</p>
      <div class="quick-grid">
        {#each Object.entries(quickApps) as [name, pkg]}
          <button class="quick-btn" onclick={() => adb.launchApp(pkg)}>
            <span class="qb-label">{name}</span>
          </button>
        {/each}
      </div>
    </Card>

  {:else if activeSection === 'device'}
    <Card title="Device Info">
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-label">Model</span>
          <span class="stat-value">{device.model}</span>
        </div>
        <div class="stat">
          <span class="stat-label">IP</span>
          <span class="stat-value mono">{device.ip}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Storage</span>
          <span class="stat-value mono">{device.freeSpace}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Firmware</span>
          <span class="stat-value mono">{device.firmwareVersion}</span>
        </div>
        <div class="stat">
          <span class="stat-label">WiFi</span>
          <span class="stat-value">{device.ssid}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Signal</span>
          <span class="stat-value mono">{device.signalStrength}</span>
        </div>
      </div>
    </Card>

    <Card title="App Detection">
      <p class="hint">How the app detects which game is currently running.</p>
      <div class="detection-toggle">
        <button
          class="det-btn"
          class:active={detectionMethod === 'appusage'}
          onclick={() => detectionMethod = 'appusage'}
        >
          App Usage
        </button>
        <button
          class="det-btn"
          class:active={detectionMethod === 'logcat'}
          onclick={() => detectionMethod = 'logcat'}
        >
          Logcat
        </button>
      </div>
      <p class="det-hint">
        {detectionMethod === 'appusage'
          ? 'Reliable but slightly slower. Detects foreground apps including 2D.'
          : 'Fast but may miss already-running apps brought to foreground.'}
      </p>
    </Card>

    <Card title="Settings Backup">
      <p class="hint">Save or restore all debug.oculus properties.</p>
      <div class="settings-actions">
        <Button onclick={saveSettings}>Save Current</Button>
        <Button onclick={loadSettings}>Restore Backup</Button>
        <Button onclick={showCurrentSettings}>View Properties</Button>
        <Button variant="danger" onclick={() => adb.clearAllSettings()}>Clear All</Button>
      </div>
    </Card>

    <Card title="File Sharing">
      <Toggle
        checked={false}
        label="HTTP server"
        description="Not available — requires native plugin"
        disabled
      />
    </Card>

  {:else if activeSection === 'console'}
    <Card title="Shell">
      <p class="hint">Run shell commands directly on the headset.</p>
      <div class="console">
        <div class="input-row">
          <input
            type="text"
            class="text-input"
            bind:value={shellInput}
            placeholder="setprop debug.oculus.cpuLevel 4"
            onkeydown={(e) => { if (e.key === 'Enter') runCommand(shellInput, () => shellInput = '') }}
          />
          <Button size="sm" variant="primary" onclick={() => runCommand(shellInput, () => shellInput = '')}>Run</Button>
        </div>
        {#if consoleOutput}
          <pre class="output">{consoleOutput}</pre>
        {/if}
      </div>
    </Card>

    <Card title="Saved Scripts">
      <p class="hint">Tap to run, long-press to edit. Empty slots can be configured.</p>
      <div class="script-slots">
        {#each Array(4) as _, i}
          <button
            class="script-slot"
            class:filled={!!scripts[i]}
            onclick={() => handleScriptClick(i)}
            oncontextmenu={(e) => { e.preventDefault(); editScript(i) }}
          >
            <span class="slot-num">{i + 1}</span>
            <span class="slot-label">{scripts[i]?.name || 'Empty slot'}</span>
          </button>
        {/each}
      </div>
    </Card>

  {:else if activeSection === 'actions'}
    <Card title="Quick Actions">
      <p class="hint">Common system operations for the headset.</p>
      <div class="sys-actions">
        <button class="sys-btn" onclick={async () => { consoleOutput = await adb.shell('dumpsys deviceidle'); activeSection = 'console' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
            <path d="M13 2v7h7" />
          </svg>
          <span>Battery Info</span>
        </button>
        <button class="sys-btn" onclick={() => adb.toggleScreen()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18.36 6.64a9 9 0 11-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
          <span>Toggle Screen</span>
        </button>
        <button class="sys-btn" onclick={() => adb.restartQuestHome()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
            <path d="M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          <span>Restart Home</span>
        </button>
        <button class="sys-btn" onclick={() => adb.killBackground()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Kill Background</span>
        </button>
        <button class="sys-btn" onclick={() => adb.openAndroidSettings()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span>Android Settings</span>
        </button>
        <button class="sys-btn danger" onclick={() => adb.reboot()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
          <span>Reboot</span>
        </button>
      </div>
    </Card>
  {/if}
</div>

<style>
  .sys {
    padding: 0 16px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Section tabs (matches Recording pattern) */
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

  .hint {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .btn-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .btn-row.wrap {
    flex-wrap: wrap;
  }

  /* Shared input styles */
  .text-input {
    flex: 1;
    height: 44px;
    padding: 0 14px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .text-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-glow);
  }

  .text-input::placeholder {
    color: var(--text-muted);
  }

  .output {
    margin-top: 8px;
    max-height: 180px;
    overflow: auto;
    padding: 14px;
    background: var(--surface-solid);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--primary);
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.6;
  }

  /* Apps section */
  .install-row {
    display: flex;
    gap: 8px;
  }

  .quick-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .quick-btn {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .quick-btn:hover {
    background: var(--surface-hover);
  }

  .quick-btn:active {
    transform: scale(0.97);
  }

  .qb-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  /* Device section */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-label {
    font-family: var(--font-display);
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .detection-toggle {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
    margin-bottom: 10px;
  }

  .det-btn {
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

  .det-btn:last-child {
    border-right: none;
  }

  .det-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .det-hint {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .settings-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Console section */
  .console {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .script-slots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .script-slot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    background: var(--surface-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .script-slot:hover {
    background: var(--surface-hover);
    border-style: solid;
  }

  .script-slot.filled {
    border-style: solid;
    border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
  }

  .script-slot.filled .slot-label {
    color: var(--text-secondary);
  }

  .slot-num {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .slot-label {
    font-size: 13px;
    color: var(--text-muted);
  }

  /* Actions section */
  .sys-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .sys-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 80px;
    padding: 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .sys-btn:hover {
    background: var(--surface-hover);
  }

  .sys-btn:active {
    transform: scale(0.95);
  }

  .sys-btn svg {
    width: 22px;
    height: 22px;
    color: var(--text-secondary);
  }

  .sys-btn span {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
  }

  .sys-btn.danger {
    border-color: var(--danger-dim);
  }

  .sys-btn.danger svg {
    color: var(--danger);
  }

  .sys-btn.danger span {
    color: var(--danger);
  }
</style>
