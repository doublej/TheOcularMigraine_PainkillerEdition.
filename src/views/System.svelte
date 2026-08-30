<script module lang="ts">
  // Module scope on purpose: App.svelte unmounts this view on every tab switch, and the
  // console round trip (run a command, go tune something, come back) is the one that lost data.
  let activeSection = $state<'device' | 'apps' | 'console'>('device')
  let consoleOutput = $state('')
  let consoleFailed = $state(false)
  let recentPaths = $state<string[]>([])
  let recentCommands = $state<string[]>([])

  /** Newest first, no duplicates, capped — retyping a path on a phone keyboard is the expensive part. */
  function rememberValue(list: string[], value: string): string[] {
    return [value, ...list.filter(v => v !== value)].slice(0, 5)
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Card from '../lib/components/ui/Card.svelte'
  import Button from '../lib/components/ui/Button.svelte'
  import Toggle from '../lib/components/ui/Toggle.svelte'
  import AppPicker from '../lib/components/ui/AppPicker.svelte'
  import {
    getDevice, getConnectionMode, isDemoMode, isDeviceInfoFixture, refreshDevice,
    getAbilities, getPrivilege,
  } from '../lib/stores/device.svelte'
  import { whyNot } from '../lib/bridge/capabilities'
  import { t } from '../lib/i18n/index.svelte'
  import { showToast } from '../lib/stores/toast.svelte'
  import * as adb from '../lib/bridge/adb'
  import * as persistence from '../lib/stores/persistence'
  import type { AccessMode, UserScript } from '../lib/stores/persistence'

  /** On native this app is in `pm list packages -3` itself, so a sweep must never disable it. */
  const SELF_PACKAGE = 'com.ocularmigraine.mcp'

  const device = $derived(getDevice())
  const nativeMode = $derived(getConnectionMode() === 'native')

  /**
   * What this route can actually run. A control that would fail on tap is disabled rather than
   * left to toast a failure; a read that comes back partial is explained instead, which is why
   * Device Info below is never gated — Promise.allSettled plus show() already renders it honestly.
   */
  const can = $derived(getAbilities())

  let sectionTop: HTMLElement | undefined = $state()

  /** Key of the action currently talking to the headset — one at a time, so a double tap cannot fire twice. */
  let pending = $state('')
  /**
   * Key of the destructive action waiting for its second tap: the control's own identity plus, for
   * a command, the exact text it will send. Nothing else can satisfy another control's confirm, and
   * editing the command disarms it. window.confirm blocks the Capacitor WebView.
   */
  let armed = $state('')
  let armTimer: ReturnType<typeof setTimeout> | undefined

  function describeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  /**
   * A fixture answer is not this headset's. Anything that would print a read as device truth, or
   * store it, or sweep against it, calls this first — throwing is the only honest outcome, because
   * the alternative is a backup full of invented props and a library swept against six mock names.
   */
  function assertRealRead() {
    if (adb.isFixtureRead()) throw new Error(t('system.toast.noHeadsetRead'))
  }

  /** Arming outlives neither the moment, the section nor the view: a stray second tap must not walk through. */
  function disarm() {
    clearTimeout(armTimer)
    armed = ''
  }

  onDestroy(disarm)

  /** Two taps for anything that cannot be undone: the first arms, the second fires. */
  function armAction(key: string, run: () => void) {
    if (armed === key) {
      disarm()
      run()
      return
    }
    clearTimeout(armTimer)
    armed = key
    armTimer = setTimeout(() => (armed = ''), 5000)
  }

  function selectSection(next: 'device' | 'apps' | 'console') {
    activeSection = next
    disarm()
    // The access confirm is a panel, not a button, so it does not disarm itself when its card
    // stops rendering: without this, leaving Apps and coming back re-offers a live Apply.
    requestedMode = null
    if (next === 'apps' && !accessReadAt) loadPackageState()
  }

  /** Every headset write reports both ways: an invisible failure looks exactly like a success. */
  async function runAction(key: string, action: () => Promise<string>) {
    if (pending) return
    pending = key
    try {
      const message = await action()
      if (isDemoMode()) showToast(t('system.toast.demoSuffix', { message }), 'info')
      else showToast(message, 'success')
    } catch (e) {
      showToast(describeError(e), 'error')
    } finally {
      pending = ''
    }
  }

  // Section tabs swap content inside a scroll container that keeps its offset, so a tap can land mid-page.
  $effect(() => {
    activeSection
    sectionTop?.scrollIntoView({ block: 'start' })
  })

  // --- Device info ---

  let deviceReadAt = $state(0)
  let deviceError = $state('')
  let actionOutput = $state('')

  /** Fixtures are not this headset: an invented model and battery level must never render as a reading. */
  const fixtureInfo = $derived(isDeviceInfoFixture())

  const show = (value: string | number) => (fixtureInfo ? '—' : value || '—')

  const batteryLine = $derived(
    !fixtureInfo && device.battery
      ? device.charging
        ? t('system.device.batteryCharging', { level: device.battery })
        : t('system.device.batteryLevel', { level: device.battery })
      : '—',
  )
  const storageLine = $derived(
    fixtureInfo || !device.freeSpace
      ? '—'
      : device.totalSpace
        ? t('system.device.storageOf', { free: device.freeSpace, total: device.totalSpace })
        : device.freeSpace,
  )
  const signalLine = $derived(
    !fixtureInfo && device.signalStrength
      ? t('system.device.signal', {
          quality: describeSignal(device.signalStrength),
          rssi: device.signalStrength,
        })
      : '—',
  )
  const readAtLabel = $derived(
    fixtureInfo
      ? t('system.device.noHeadset')
      : deviceReadAt
        ? t('system.device.readAt', { time: new Date(deviceReadAt).toLocaleTimeString() })
        : t('system.device.notRead'),
  )

  /** Raw RSSI means nothing to someone deciding whether to walk closer to the router. */
  function describeSignal(rssi: number): string {
    if (rssi >= -50) return t('system.signal.excellent')
    if (rssi >= -60) return t('system.signal.good')
    if (rssi >= -70) return t('system.signal.fair')
    return t('system.signal.weak')
  }

  /** Never throws: on arrival the failure belongs on the card, not in a sticky toast. */
  async function loadDeviceInfo() {
    deviceError = ''
    try {
      await refreshDevice()
      deviceReadAt = Date.now()
    } catch (e) {
      deviceError = describeError(e)
    }
  }

  function handleRefreshDevice() {
    runAction('device', async () => {
      await refreshDevice()
      deviceReadAt = Date.now()
      deviceError = ''
      return 'Headset info updated'
    })
  }

  onMount(() => {
    loadDeviceInfo()
    loadKioskState()
    // activeSection survives the unmount this view gets on every tab switch; the package read does not.
    if (activeSection === 'apps') loadPackageState()
  })

  // --- Quick actions ---

  function readBatteryDetail() {
    runAction('battery', async () => {
      // `dumpsys battery` is refused to an app uid, so on the headset this reads the same values
      // through the framework and prints those. Off the headset the raw dump is still richer.
      const out = nativeMode
        ? await describeBattery()
        : await adb.shell('dumpsys battery')
      assertRealRead()
      actionOutput = out || '(no output)'
      return 'Battery detail read'
    })
  }

  async function describeBattery(): Promise<string> {
    const battery = await adb.getBatteryInfo()
    const storage = await adb.getStorageInfo()
    return [
      `level: ${battery.level}%`,
      `charging: ${battery.charging ? 'yes' : 'no'}`,
      `free storage: ${storage.free} of ${storage.total}`,
    ].join('\n')
  }

  function toggleHeadsetScreen() {
    runAction('screen', async () => {
      await adb.toggleScreen()
      return 'Screen power key sent'
    })
  }

  function restartQuestMenu() {
    runAction('home', async () => {
      await adb.restartQuestHome()
      return 'Quest menu restarted'
    })
  }

  function closeBackgroundApps() {
    runAction('kill', async () => {
      await adb.killBackground()
      return 'Background apps closed'
    })
  }

  function openAndroidSettings() {
    runAction('settings', async () => {
      await adb.openAndroidSettings()
      return 'Android settings opened on the headset'
    })
  }

  function rebootHeadset() {
    runAction('reboot', async () => {
      await adb.reboot()
      return 'Rebooting — the headset is unusable for about a minute'
    })
  }

  // --- Settings backup ---

  let backups = $state(persistence.loadSettingsBackups())
  /** Which snapshot Restore will write. Every kept snapshot is reachable, or the count is a lie. */
  let restoreIndex = $state(0)
  let propsOutput = $state('')

  const selectedBackup = $derived(backups[restoreIndex] ?? backups[0])

  const countTweaks = (props: Record<string, string>) => {
    const n = Object.keys(props).length
    return n === 1 ? t('system.backup.tweakOne', { n }) : t('system.backup.tweakMany', { n })
  }

  const backupSummary = $derived(
    !selectedBackup
      ? t('system.backup.none')
      : backups.length > 1
        ? t('system.backup.summaryKept', {
            tweaks: countTweaks(selectedBackup.props),
            when: formatWhen(selectedBackup.takenAt),
            kept: backups.length,
          })
        : t('system.backup.summary', {
            tweaks: countTweaks(selectedBackup.props),
            when: formatWhen(selectedBackup.takenAt),
          }),
  )

  function formatWhen(takenAt: number): string {
    return takenAt
      ? new Date(takenAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : t('system.backup.older')
  }

  function backUpSettings() {
    runAction('backup', async () => {
      const props = await adb.getCurrentOculusProps()
      // Six invented props must never become a snapshot that can later be restored onto a real headset.
      assertRealRead()
      // Only the props holding a value are stored, so the tally has to come from the snapshot, not the read.
      const snapshot = persistence.saveSettingsBackup(props)
      if (!snapshot) throw new Error(t('system.toast.nothingToBackUp'))
      backups = persistence.loadSettingsBackups()
      restoreIndex = 0
      return `Backed up ${Object.keys(snapshot.props).length} tweaks`
    })
  }

  function restoreSettings() {
    runAction('restore', async () => {
      const props = selectedBackup?.props
      if (!props) throw new Error(t('system.toast.noBackup'))
      let written = 0
      for (const [key, value] of Object.entries(props)) {
        // A blanked prop reads back empty, and `setprop key` with no value is a usage error that
        // would abort the loop halfway through.
        if (!value) continue
        await adb.setprop(key, value)
        written++
      }
      // Non-throwing on purpose: the write already landed, so a failed re-read must not read as a failed restore.
      await loadDeviceInfo()
      return `${written} tweaks restored — restart the running app for resolution changes to apply`
    })
  }

  function showCurrentSettings() {
    runAction('props', async () => {
      const props = await adb.getCurrentOculusProps()
      assertRealRead()
      const lines = Object.entries(props).map(([k, v]) => `${k} = ${v}`)
      propsOutput = lines.join('\n') || 'This headset is on stock settings — nothing has been tweaked.'
      return lines.length ? `${lines.length} tweaks listed` : 'No tweaks set'
    })
  }

  function eraseAllSettings() {
    runAction('erase', async () => {
      // The wipe takes its own snapshot: restore used to depend on the user having pressed Save first.
      const props = await adb.getCurrentOculusProps()
      assertRealRead()
      const snapshot = persistence.saveSettingsBackup(props)
      if (snapshot) {
        backups = persistence.loadSettingsBackups()
        restoreIndex = 0
      }
      const count = Object.keys(snapshot?.props ?? {}).length
      await adb.clearAllSettings()
      await loadDeviceInfo()
      // A blank headset has nothing to snapshot, so claiming a backup was taken would be a lie.
      return count ? `${count} tweaks erased — a backup was saved first` : 'Nothing was set — the headset was already on defaults'
    })
  }

  // --- Install APK ---

  let apkPath = $state('')
  let installOutput = $state('')
  let installFailed = $state(false)

  /** The path lands inside a double-quoted shell string downstream, so a quote would escape it. */
  const APK_PATH = /^[A-Za-z0-9 _./\\:-]+\.apk$/i

  const installHint = $derived(
    nativeMode ? t('system.install.hintHeadset') : t('system.install.hintBridge'),
  )
  const installPlaceholder = $derived(nativeMode ? '/sdcard/Download/app.apk' : 'C:\\Users\\you\\Downloads\\app.apk')

  function installApk() {
    const path = apkPath.trim()
    if (!path || pending) return
    if (!APK_PATH.test(path)) {
      installOutput = 'That does not look like a path to an .apk file.'
      installFailed = true
      showToast(t('system.toast.needApkPath'), 'error')
      return
    }
    installOutput = 'Installing…'
    installFailed = false
    // Through runAction like every other write, so a demo install cannot toast green.
    runAction('install', async () => {
      try {
        const out = await adb.installApk(path)
        // pm prints Failure and still exits 0 on some builds, so the output is the only real check.
        if (/failure/i.test(out)) throw new Error(out.trim())
        recentPaths = rememberValue(recentPaths, path)
        apkPath = ''
        if (isDemoMode()) {
          installOutput = 'No headset attached — nothing was installed.'
          return 'Nothing installed'
        }
        installOutput = out || 'Install finished (no output).'
        return 'APK installed'
      } catch (e) {
        // The path stays in the field: one wrong character should not cost a full retype.
        installOutput = describeError(e)
        installFailed = true
        throw e
      }
    })
  }

  // --- Single app (kiosk) mode ---

  let kioskApp = $state(persistence.getKioskApp())
  let kioskEnabled = $state(false)
  let kioskUnknown = $state(false)
  let kioskPickerOpen = $state(false)
  /** applyKiosk runs outside runAction, so `pending` cannot speak for it. */
  let kioskBusy = $state(false)

  /** The headset is the truth: a locked headset must not render an innocent OFF switch, and neither must no headset. */
  async function loadKioskState() {
    try {
      const raw = await adb.getprop('persist.oculus.kiosk_mode')
      assertRealRead()
      kioskEnabled = raw === '1'
      kioskUnknown = false
    } catch {
      kioskUnknown = true
    }
  }

  /**
   * Thrown errors are the contract: Toggle reverts the switch and shows them.
   *
   * This is the one headset write that does not go through runAction — it has to throw, and
   * runAction swallows — so it raises its own flag. Without it "Change app" stays live while
   * this writes persist.oculus.kiosk_app, which is the very prop that button overwrites.
   */
  async function applyKiosk(enabled: boolean) {
    if (enabled && !kioskApp) throw new Error(t('system.toast.needKioskApp'))
    kioskBusy = true
    try {
      await adb.setprop('persist.oculus.kiosk_mode', enabled ? '1' : '0')
      if (enabled) await adb.setprop('persist.oculus.kiosk_app', kioskApp)
      // setprop never fails on a property the system ignores, so the read-back is the only real check.
      const readBack = await adb.getprop('persist.oculus.kiosk_mode')
      // Without this the fixture read-back blames a device-owner headset for there being no headset.
      assertRealRead()
      if (readBack !== (enabled ? '1' : '0')) {
        throw new Error(t('system.toast.kioskRefused', { readBack: readBack || t('system.toast.kioskEmpty') }))
      }
      kioskUnknown = false
      showToast(enabled ? t('system.toast.kioskSet') : t('system.toast.kioskCleared'), 'success')
    } finally {
      kioskBusy = false
    }
  }

  function selectKioskApp(pkg: string) {
    kioskApp = pkg
    persistence.setKioskApp(pkg)
    kioskPickerOpen = false
    if (!kioskEnabled) return
    runAction('kiosk-app', async () => {
      await adb.setprop('persist.oculus.kiosk_app', pkg)
      return 'Locked app changed — it applies after a headset restart'
    })
  }

  // --- Favourite app ---

  let favouriteApp = $state(persistence.getStartupApp())
  let favouritePickerOpen = $state(false)

  function selectFavouriteApp(pkg: string) {
    favouriteApp = pkg
    persistence.setStartupApp(pkg)
    favouritePickerOpen = false
  }

  function clearFavouriteApp() {
    favouriteApp = ''
    persistence.setStartupApp('')
  }

  // --- Access control ---

  let requestedMode = $state<AccessMode | null>(null)
  let accessProgress = $state('')
  let whitelist = $state(persistence.getWhitelist())
  let blacklist = $state(persistence.getBlacklist())
  let whitelistPickerOpen = $state(false)
  let blacklistPickerOpen = $state(false)

  // The headset is the truth here too: a stored mode says what this phone last asked for, not what
  // the library looks like. Everything below is derived from these two reads or from nothing.
  let installedPkgs = $state<string[]>([])
  let disabledPkgs = $state<string[]>([])
  let accessReadAt = $state(0)
  let accessError = $state('')
  let accessLoading = $state(false)

  const parsePackages = (raw: string) =>
    raw.split('\n').map(l => l.trim().replace('package:', '')).filter(Boolean)

  async function readPackages(): Promise<{ installed: string[]; disabled: string[] }> {
    const installed = await adb.getInstalledPackages()
    const disabled = parsePackages(await adb.shell('pm list packages -d -3'))
    assertRealRead()
    return { installed, disabled }
  }

  async function loadPackageState() {
    if (accessLoading) return
    accessLoading = true
    try {
      const { installed, disabled } = await readPackages()
      installedPkgs = installed
      disabledPkgs = disabled
      accessReadAt = Date.now()
      accessError = ''
    } catch (e) {
      accessReadAt = 0
      accessError = describeError(e)
    } finally {
      accessLoading = false
    }
  }

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(v => b.includes(v))

  /** The lists are localStorage; only the packages this headset actually has can be swept. */
  function plannedTargets(mode: AccessMode, installed: string[]): string[] {
    if (mode === 'off') return []
    return installed.filter(pkg =>
      pkg !== SELF_PACKAGE && (mode === 'allow' ? !whitelist.includes(pkg) : blacklist.includes(pkg)),
    )
  }

  /** What the headset is in, read back from it. '' means nothing was read, which is not the same as Off. */
  const headsetMode = $derived.by((): AccessMode | 'mixed' | '' => {
    if (!accessReadAt) return ''
    if (disabledPkgs.length === 0) return 'off'
    if (sameSet(plannedTargets('allow', installedPkgs), disabledPkgs)) return 'allow'
    if (sameSet(plannedTargets('block', installedPkgs), disabledPkgs)) return 'block'
    return 'mixed'
  })

  const accessSummary = $derived(
    accessLoading
      ? t('system.access.reading')
      : !accessReadAt
        ? t('system.access.notRead')
        : headsetMode === 'off'
          ? t('system.access.summaryOff', { total: installedPkgs.length })
          : headsetMode === 'mixed'
            ? t('system.access.summaryMixed', {
                disabled: disabledPkgs.length,
                total: installedPkgs.length,
              })
            : headsetMode === 'allow'
              ? t('system.access.summaryAllow', {
                  disabled: disabledPkgs.length,
                  total: installedPkgs.length,
                })
              : t('system.access.summaryBlock', {
                  disabled: disabledPkgs.length,
                  total: installedPkgs.length,
                }),
  )

  const plannedCount = $derived(requestedMode ? plannedTargets(requestedMode, installedPkgs).length : 0)
  const allowedInstalled = $derived(whitelist.filter(pkg => installedPkgs.includes(pkg)).length)

  const accessConfirmText = $derived(
    requestedMode === 'off'
      ? t('system.access.confirmOff', { total: installedPkgs.length })
      : requestedMode === 'allow'
        ? t('system.access.confirmAllow', {
            planned: plannedCount,
            total: installedPkgs.length,
            allowed: allowedInstalled,
            listed: whitelist.length,
          })
        : t('system.access.confirmBlock', { planned: plannedCount, listed: blacklist.length }),
  )

  /**
   * Sequential on purpose: dozens of parallel shell spawns with no count is how the old sweep hid
   * its failures. A package that refuses is counted so the caller can report the real tally.
   */
  async function sweepPackages(pkgs: string[], verb: string, run: (pkg: string) => Promise<string>): Promise<number> {
    let failed = 0
    for (let i = 0; i < pkgs.length; i++) {
      accessProgress = `${verb} ${i + 1}/${pkgs.length}…`
      try {
        await run(pkgs[i])
      } catch {
        failed++
      }
    }
    return failed
  }

  async function applyAccessMode(next: AccessMode): Promise<string> {
    const list = next === 'allow' ? whitelist : blacklist
    if (next !== 'off' && list.length === 0) {
      throw new Error(next === 'allow'
        ? t('system.toast.emptyAllowList')
        : t('system.toast.emptyBlockList'))
    }
    // Re-read rather than trust the card: the sweep must act on this headset's list, right now.
    const { installed } = await readPackages()
    installedPkgs = installed
    if (installed.length === 0) throw new Error(t('system.toast.noAppList'))
    const targets = plannedTargets(next, installed)
    if (next !== 'off' && targets.length === 0) {
      throw new Error(next === 'allow'
        ? t('system.toast.allowListCoversAll')
        : t('system.toast.blockListMatchesNone'))
    }
    try {
      // Every transition starts from a clean headset, so switching modes — or turning this off — really restores apps.
      const restoreFailed = await sweepPackages(installed, 'Restoring', adb.enablePackage)
      // A tally with failures in it is a failed sweep: the library is now in a state nobody asked for.
      if (restoreFailed) {
        throw new Error(t('system.toast.restoreMixed', { ok: installed.length - restoreFailed, total: installed.length, failed: restoreFailed }))
      }
      if (next === 'off') return `${installed.length} apps re-enabled`
      const disableFailed = await sweepPackages(targets, 'Disabling', adb.disablePackage)
      if (disableFailed) {
        throw new Error(t('system.toast.disableMixed', { ok: targets.length - disableFailed, total: targets.length, failed: disableFailed }))
      }
      return `${targets.length} apps disabled`
    } finally {
      accessProgress = ''
    }
  }

  function confirmAccessMode() {
    const next = requestedMode
    if (!next) return
    requestedMode = null
    runAction('access', async () => {
      try {
        return await applyAccessMode(next)
      } finally {
        // Nothing is recorded: the segmented control follows the headset, so a half-finished sweep shows as it is.
        await loadPackageState()
      }
    })
  }

  // --- Quick launch ---

  const quickApps: Record<string, string> = {
    'File Manager': 'com.oculus.filemanager',
    'SideQuest': 'com.sidequest.wrapper',
    'F-Droid': 'org.fdroid.fdroid',
    'OVR Metrics': 'com.oculus.ovrmonitormetricsservice',
  }

  let launchPickerOpen = $state(false)

  function launchPackage(pkg: string) {
    runAction(`launch-${pkg}`, async () => {
      await adb.launchApp(pkg)
      return `Launched ${pkg}`
    })
  }

  // --- Console ---

  let shellInput = $state('')

  /** These end the session or take something away; everything else stays one tap. */
  const DESTRUCTIVE_COMMAND = /\b(pm\s+(uninstall|disable|clear)|rm\s+|svc\s+power|reboot|wipe|am\s+(force-stop|kill))/i

  /** One command control: which control it is, plus the exact text it would send. Editing either disarms. */
  const commandKey = (control: string, command: string) => `${control}:${command.trim()}`

  const isArmed = (control: string, command: string) => armed === commandKey(control, command)

  /** The tapped control arms itself and says so; no other control and no panel elsewhere can answer for it. */
  function submitCommand(control: string, command: string) {
    const cmd = command.trim()
    if (!cmd || pending) return
    if (DESTRUCTIVE_COMMAND.test(cmd)) {
      armAction(commandKey(control, cmd), () => runCommand(cmd))
      return
    }
    disarm()
    runCommand(cmd)
  }

  function runCommand(cmd: string) {
    runAction('shell', async () => {
      try {
        const out = await adb.shell(cmd)
        // The command is echoed so a stale pane is never mistaken for a fresh result.
        consoleOutput = `$ ${cmd}\n${out || '(ok, no output)'}`
        consoleFailed = false
        recentCommands = rememberValue(recentCommands, cmd)
        if (cmd === shellInput.trim()) shellInput = ''
        return 'Command ran'
      } catch (e) {
        consoleOutput = `$ ${cmd}\n${describeError(e)}`
        consoleFailed = true
        throw e
      }
    })
  }

  // --- Saved scripts ---

  let scripts = $state<UserScript[]>(persistence.loadUserScripts().filter((s): s is UserScript => !!s))
  let editingIndex = $state(-1)
  let editName = $state('')
  let editCommand = $state('')

  function openScriptEditor(index: number) {
    editingIndex = index
    editName = scripts[index]?.name ?? ''
    editCommand = scripts[index]?.command ?? shellInput.trim()
    disarm()
  }

  function saveScript() {
    const name = editName.trim()
    const command = editCommand.trim()
    if (!name || !command) return
    if (editingIndex >= scripts.length) scripts.push({ slot: scripts.length, name, command })
    else scripts[editingIndex] = { slot: editingIndex, name, command }
    persistence.saveUserScripts(scripts)
    editingIndex = -1
  }

  function deleteScript() {
    scripts = scripts.filter((_, i) => i !== editingIndex).map((s, i) => ({ ...s, slot: i }))
    persistence.saveUserScripts(scripts)
    editingIndex = -1
  }
</script>

{#snippet outputPane(text: string, failed: boolean, clear: () => void)}
  {#if text}
    <div class="output-wrap">
      <pre class="output" class:failed={failed}>{text}</pre>
      <button class="output-clear" onclick={clear}>{t('system.output.clear')}</button>
    </div>
  {/if}
{/snippet}

{#snippet recents(values: string[], apply: (value: string) => void)}
  {#if values.length}
    <div class="recents">
      {#each values as value}
        <button class="recent" onclick={() => apply(value)}>{value}</button>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="sys">
  <div class="seg" bind:this={sectionTop}>
    <button class="seg-btn" class:active={activeSection === 'device'} onclick={() => selectSection('device')}>
      {t('system.tab.device')}
    </button>
    <button class="seg-btn" class:active={activeSection === 'apps'} onclick={() => selectSection('apps')}>
      {t('system.tab.apps')}
    </button>
    <button class="seg-btn" class:active={activeSection === 'console'} onclick={() => selectSection('console')}>
      {t('system.tab.console')}
    </button>
  </div>

  {#if activeSection === 'device'}
    <Card title={t('system.device.title')}>
      <div class="card-head">
        <span class="read-at" class:stale={fixtureInfo || !deviceReadAt}>{readAtLabel}</span>
        <Button size="sm" disabled={!!pending} onclick={handleRefreshDevice}>
          {pending === 'device' ? t('system.busy.reading') : t('system.device.refresh')}
        </Button>
      </div>
      {#if deviceError}
        <p class="error-line">{t('system.device.readFailed', { error: deviceError })}</p>
      {/if}
      {#if !can.deviceServices}
        <p class="hint">
          {t('system.device.servicesOff', { why: whyNot('deviceServices', getPrivilege()) })}
        </p>
      {/if}
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-label">{t('system.device.model')}</span>
          <span class="stat-value">{show(device.model)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.battery')}</span>
          <span class="stat-value mono">{batteryLine}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.freeStorage')}</span>
          <span class="stat-value mono">{storageLine}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.osBuild')}</span>
          <span class="stat-value mono">{show(device.firmwareVersion)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.wifi')}</span>
          <span class="stat-value">{show(device.ssid)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.wifiSignal')}</span>
          <span class="stat-value mono">{signalLine}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{t('system.device.ip')}</span>
          <span class="stat-value mono">{show(device.ip)}</span>
        </div>
      </div>
    </Card>

    <Card title={t('system.quick.title')}>
      <p class="hint">{t('system.quick.hint')}</p>
      {#if !can.manageApps}
        <p class="hint">
          {t('system.quick.manageOff', { why: whyNot('manageApps', getPrivilege()) })}
        </p>
      {/if}
      <div class="sys-actions">
        <button class="sys-btn" disabled={!!pending || !can.deviceServices} onclick={readBatteryDetail}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="16" height="10" rx="2" />
            <line x1="21" y1="10" x2="21" y2="14" />
          </svg>
          <span>{pending === 'battery' ? t('system.busy.reading') : t('system.quick.batteryDetail')}</span>
        </button>
        <button class="sys-btn" class:armed={armed === 'screen'} disabled={!!pending || !can.manageApps} onclick={() => armAction('screen', toggleHeadsetScreen)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18.36 6.64a9 9 0 11-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
          <span>{armed === 'screen' ? t('system.tapAgain') : t('system.quick.screen')}</span>
        </button>
        <button class="sys-btn" class:armed={armed === 'home'} disabled={!!pending || !can.manageApps} onclick={() => armAction('home', restartQuestMenu)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
            <path d="M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          <span>{armed === 'home' ? t('system.tapAgain') : t('system.quick.restartMenu')}</span>
        </button>
        <button class="sys-btn danger" class:armed={armed === 'kill'} disabled={!!pending} onclick={() => armAction('kill', closeBackgroundApps)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{armed === 'kill' ? t('system.tapAgain') : t('system.quick.closeBackground')}</span>
        </button>
        <button class="sys-btn" disabled={!!pending} onclick={openAndroidSettings}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span>{t('system.quick.androidSettings')}</span>
        </button>
      </div>
      {@render outputPane(actionOutput, false, () => actionOutput = '')}
      <p class="hint action-note">
        {t('system.quick.note')}
      </p>
      <div class="danger-zone">
        <Button variant="danger" disabled={!!pending || !can.manageApps} onclick={() => armAction('reboot', rebootHeadset)}>
          {armed === 'reboot' ? t('system.quick.rebootArmed') : t('system.quick.reboot')}
        </Button>
        <p class="hint">
          {t('system.quick.rebootNote')}
        </p>
      </div>
    </Card>

    <Card title={t('system.detection.title')}>
      <p class="hint">
        {t('system.detection.body')}
      </p>
    </Card>

    <Card title={t('system.backup.title')}>
      <p class="hint">{t('system.backup.hint')}</p>
      <p class="backup-state">{backupSummary}</p>
      {#if backups.length > 1}
        <div class="snaps">
          {#each backups as snap, i}
            <button class="snap" class:on={snap === selectedBackup} disabled={!!pending} onclick={() => restoreIndex = i}>
              {t('system.backup.snapshot', {
                tweaks: countTweaks(snap.props),
                when: formatWhen(snap.takenAt),
              })}
            </button>
          {/each}
        </div>
      {/if}
      <div class="settings-actions">
        <Button disabled={!!pending} onclick={backUpSettings}>
          {pending === 'backup' ? t('system.busy.backingUp') : t('system.backup.now')}
        </Button>
        <Button disabled={!!pending || !backups.length || !can.writeProps} onclick={() => armAction('restore', restoreSettings)}>
          {#if pending === 'restore'}
            {t('system.busy.restoring')}
          {:else if armed === 'restore'}
            {t('system.backup.restoreArmed')}
          {:else}
            {t('system.backup.restore')}
          {/if}
        </Button>
        <Button disabled={!!pending} onclick={showCurrentSettings}>{t('system.backup.showAll')}</Button>
      </div>
      {@render outputPane(propsOutput, false, () => propsOutput = '')}
      <div class="danger-zone">
        <Button variant="danger" disabled={!!pending || !can.writeProps} onclick={() => armAction('erase', eraseAllSettings)}>
          {#if pending === 'erase'}
            {t('system.busy.erasing')}
          {:else if armed === 'erase'}
            {t('system.backup.eraseArmed')}
          {:else}
            {t('system.backup.erase')}
          {/if}
        </Button>
        <p class="hint">
          {t('system.backup.eraseNote')}
        </p>
      </div>
    </Card>

    <Card title={t('system.files.title')}>
      <Toggle
        checked={false}
        label={t('system.files.label')}
        description={t('system.files.description')}
        disabled
      />
    </Card>

  {:else if activeSection === 'apps'}
    {#if !can.manageApps}
      <p class="section-note">
        {t('system.apps.manageOff', { why: whyNot('manageApps', getPrivilege()) })}
      </p>
    {/if}

    <Card title={t('system.install.title')}>
      <p class="hint">{installHint}</p>
      <div class="install-row">
        <input
          type="text"
          class="text-input"
          placeholder={installPlaceholder}
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          enterkeyhint="go"
          disabled={pending === 'install'}
          bind:value={apkPath}
          onkeydown={(e) => { if (e.key === 'Enter') installApk() }}
        />
        <Button size="sm" variant="primary" disabled={!!pending || !apkPath.trim() || !can.installApk} onclick={installApk}>
          {pending === 'install' ? t('system.busy.installing') : t('system.install.button')}
        </Button>
      </div>
      {@render recents(recentPaths, (value) => apkPath = value)}
      {@render outputPane(installOutput, installFailed, () => installOutput = '')}
    </Card>

    <Card title={t('system.kiosk.title')}>
      <p class="hint">
        {t('system.kiosk.hint')}
      </p>
      <Toggle
        bind:checked={kioskEnabled}
        label={t('system.kiosk.label')}
        description={kioskUnknown
          ? t('system.kiosk.unreadable')
          : kioskApp || t('system.app.noneChosen')}
        disabled={(!kioskApp && !kioskEnabled) || !!pending || !can.manageApps}
        confirm={kioskEnabled ? t('system.kiosk.confirmUnlock') : t('system.kiosk.confirmLock')}
        onchange={applyKiosk}
      />
      <div class="btn-row">
        <Button size="sm" disabled={!!pending || kioskBusy} onclick={() => kioskPickerOpen = true}>
          {kioskApp ? t('system.app.change') : t('system.app.choose')}
        </Button>
      </div>
    </Card>
    <AppPicker bind:open={kioskPickerOpen} title={t('system.kiosk.pickerTitle')} current={kioskApp} onselect={selectKioskApp} />

    <Card title={t('system.favourite.title')}>
      <p class="hint">
        {t('system.favourite.hint')}
      </p>
      <p class="pkg-line">{favouriteApp || t('system.app.noneChosen')}</p>
      <div class="btn-row wrap">
        <Button size="sm" onclick={() => favouritePickerOpen = true}>
          {favouriteApp ? t('system.app.change') : t('system.app.choose')}
        </Button>
        <Button size="sm" variant="primary" disabled={!favouriteApp || !!pending || !can.launchApps} onclick={() => launchPackage(favouriteApp)}>
          {t('system.favourite.launch')}
        </Button>
        {#if favouriteApp}
          <Button size="sm" variant="ghost" onclick={clearFavouriteApp}>{t('system.favourite.clear')}</Button>
        {/if}
      </div>
    </Card>
    <AppPicker bind:open={favouritePickerOpen} title={t('system.favourite.pickerTitle')} current={favouriteApp} onselect={selectFavouriteApp} />

    <Card title={t('system.access.title')}>
      <p class="hint">
        {t('system.access.hint')}
      </p>
      {#if accessError}
        <p class="error-line">{accessError}</p>
      {:else}
        <p class="backup-state">{accessSummary}</p>
      {/if}
      <div class="seg">
        <button class="seg-btn" class:active={headsetMode === 'off'} disabled={!accessReadAt || !!pending || !can.manageApps} onclick={() => requestedMode = 'off'}>{t('system.access.off')}</button>
        <button class="seg-btn" class:active={headsetMode === 'allow'} disabled={!accessReadAt || !!pending || !can.manageApps} onclick={() => requestedMode = 'allow'}>{t('system.access.allowList')}</button>
        <button class="seg-btn" class:active={headsetMode === 'block'} disabled={!accessReadAt || !!pending || !can.manageApps} onclick={() => requestedMode = 'block'}>{t('system.access.blockList')}</button>
      </div>
      {#if requestedMode}
        <div class="confirm-row">
          <p class="confirm-text">{accessConfirmText}</p>
          <div class="btn-row">
            <Button size="sm" onclick={() => requestedMode = null}>{t('system.cancel')}</Button>
            <Button size="sm" variant="danger" disabled={!!pending || !can.manageApps} onclick={confirmAccessMode}>{t('system.access.apply')}</Button>
          </div>
        </div>
      {/if}
      {#if accessProgress}
        <p class="progress">{accessProgress}</p>
      {/if}
      <div class="btn-row wrap">
        <Button size="sm" disabled={!!pending || accessLoading} onclick={loadPackageState}>
          {accessLoading ? t('system.busy.reading') : t('system.access.check')}
        </Button>
        <Button size="sm" disabled={!!pending} onclick={() => whitelistPickerOpen = true}>{t('system.access.allowedApps', { count: whitelist.length })}</Button>
        <Button size="sm" disabled={!!pending} onclick={() => blacklistPickerOpen = true}>{t('system.access.blockedApps', { count: blacklist.length })}</Button>
      </div>
    </Card>
    <AppPicker
      bind:open={whitelistPickerOpen}
      title={t('system.access.allowedTitle')}
      multiple
      bind:selected={whitelist}
      ondone={persistence.setWhitelist}
    />
    <AppPicker
      bind:open={blacklistPickerOpen}
      title={t('system.access.blockedTitle')}
      multiple
      bind:selected={blacklist}
      ondone={persistence.setBlacklist}
    />

    <Card title={t('system.launch.title')}>
      <p class="hint">{t('system.launch.hint')}</p>
      <div class="quick-grid">
        {#each Object.entries(quickApps) as [name, pkg]}
          <button class="quick-btn" disabled={!!pending || !can.launchApps} onclick={() => launchPackage(pkg)}>
            <span class="qb-label">{name}</span>
          </button>
        {/each}
      </div>
      <div class="btn-row">
        <Button size="sm" onclick={() => launchPickerOpen = true}>{t('system.launch.another')}</Button>
      </div>
    </Card>
    <AppPicker bind:open={launchPickerOpen} title={t('system.launch.pickerTitle')} onselect={launchPackage} />

  {:else}
    <Card title={t('system.shell.title')}>
      <p class="hint">{t('system.shell.hint')}</p>
      <div class="input-row">
        <input
          type="text"
          class="text-input"
          bind:value={shellInput}
          placeholder="pm list packages"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          enterkeyhint="go"
          disabled={pending === 'shell'}
          onkeydown={(e) => { if (e.key === 'Enter') submitCommand('run', shellInput) }}
        />
        <Button
          size="sm"
          variant={isArmed('run', shellInput) ? 'danger' : 'primary'}
          disabled={!!pending || !shellInput.trim()}
          onclick={() => submitCommand('run', shellInput)}
        >
          {#if pending === 'shell'}
            {t('system.busy.running')}
          {:else if isArmed('run', shellInput)}
            {t('system.tapAgain')}
          {:else}
            {t('system.shell.run')}
          {/if}
        </Button>
      </div>
      {#if isArmed('run', shellInput)}
        <p class="confirm-inline">
          {t('system.shell.armedNote')}
        </p>
      {/if}
      {@render recents(recentCommands, (value) => shellInput = value)}
    </Card>

    <Card title={t('system.scripts.title')}>
      <p class="hint">{t('system.scripts.hint')}</p>
      <div class="script-list">
        {#each scripts as script, i}
          <div class="script-row">
            <button
              class="script-run"
              class:armed={isArmed(`tile${i}`, script.command)}
              disabled={!!pending}
              onclick={() => submitCommand(`tile${i}`, script.command)}
            >
              <span class="script-name">{script.name}</span>
              <span class="script-cmd">{script.command}</span>
              {#if isArmed(`tile${i}`, script.command)}
                <span class="script-warn">{t('system.scripts.armedNote')}</span>
              {/if}
            </button>
            <button class="script-edit" aria-label={t('system.scripts.edit', { name: script.name })} disabled={!!pending} onclick={() => openScriptEditor(i)}>✎</button>
          </div>
        {/each}
        <button class="script-add" onclick={() => openScriptEditor(scripts.length)}>{t('system.scripts.add')}</button>
      </div>
      {#if editingIndex >= 0}
        <div class="script-editor">
          <input
            type="text"
            class="text-input"
            placeholder={t('system.scripts.namePlaceholder')}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            bind:value={editName}
          />
          <input
            type="text"
            class="text-input"
            placeholder={t('system.scripts.commandPlaceholder')}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            bind:value={editCommand}
          />
          <div class="btn-row wrap">
            <Button size="sm" variant="primary" disabled={!editName.trim() || !editCommand.trim()} onclick={saveScript}>{t('system.scripts.save')}</Button>
            <Button size="sm" variant="ghost" onclick={() => editingIndex = -1}>{t('system.cancel')}</Button>
            {#if editingIndex < scripts.length}
              <Button size="sm" variant="danger" onclick={() => armAction('script-delete', deleteScript)}>
                {armed === 'script-delete' ? t('system.scripts.deleteArmed') : t('system.scripts.delete')}
              </Button>
            {/if}
          </div>
        </div>
      {/if}
    </Card>

    {@render outputPane(consoleOutput, consoleFailed, () => { consoleOutput = ''; consoleFailed = false })}
  {/if}
</div>

<style>
  .section-note {
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--warning);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }

  .sys {
    padding: 0 16px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* One segmented-strip recipe: the section tabs and Access Control both use it. */
  .seg {
    display: flex;
    gap: 0;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .seg-btn {
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

  .seg-btn:last-child {
    border-right: none;
  }

  .seg-btn.active {
    background: var(--primary-glow);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  .seg-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .hint {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .action-note {
    margin: 10px 0 0;
  }

  .error-line {
    margin-bottom: 10px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--danger);
    overflow-wrap: anywhere;
  }

  .progress {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--primary);
  }

  .btn-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .btn-row.wrap {
    flex-wrap: wrap;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .read-at {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .read-at.stale {
    color: var(--warning);
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

  /* A field the running action will clear or read must not accept typing meanwhile. */
  .text-input:disabled {
    opacity: 0.5;
  }

  .output-wrap {
    position: relative;
  }

  .output {
    margin-top: 8px;
    /* pre + horizontal scroll: break-all used to split package names mid-token. */
    max-height: 50vh;
    overflow: auto;
    padding: 14px 60px 14px 14px;
    background: var(--surface-solid);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--primary);
    white-space: pre;
    line-height: 1.6;
  }

  .output.failed {
    color: var(--danger);
    border-color: var(--danger-dim);
  }

  .output-clear {
    position: absolute;
    top: 14px;
    right: 8px;
    height: 28px;
    padding: 0 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }

  .recents {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .recent {
    max-width: 100%;
    height: 32px;
    padding: 0 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .confirm-row {
    margin-top: 10px;
    padding: 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--danger-dim);
    border-radius: var(--radius);
  }

  .confirm-text {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* The confirm for a command sits with the control that armed it, never in a panel further down. */
  .confirm-inline {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--warning);
  }

  .danger-zone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .danger-zone .hint {
    margin-bottom: 0;
  }

  /* Apps section */
  .install-row {
    display: flex;
    gap: 8px;
  }

  .pkg-line {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
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

  .quick-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
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
    min-width: 0;
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
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .backup-state {
    margin-bottom: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .settings-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* One chip per kept snapshot: three are stored, so all three have to be reachable. */
  .snaps {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .snap {
    min-height: 44px;
    padding: 0 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }

  .snap.on {
    border-color: var(--primary);
    color: var(--primary);
  }

  .snap:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  /* Console section */
  .input-row {
    display: flex;
    gap: 8px;
  }

  .script-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .script-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .script-run {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    background: var(--surface-elevated);
    border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border));
    border-radius: var(--radius);
    text-align: left;
    cursor: pointer;
    user-select: none;
    -webkit-touch-callout: none;
    transition: all var(--duration-fast) var(--ease-out);
  }

  .script-run:hover {
    background: var(--surface-hover);
  }

  .script-run:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .script-run.armed {
    border-color: var(--warning);
    background: var(--surface-hover);
  }

  .script-warn {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--warning);
    white-space: normal;
  }

  .script-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  /* The command is on the tile because one tap runs it — a slot named 'clean' could be an uninstall. */
  .script-cmd {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .script-edit {
    width: 44px;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: 16px;
    cursor: pointer;
  }

  .script-edit:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .script-add {
    height: 44px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .script-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  /* Quick actions grid */
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

  .sys-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
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

  .sys-btn.armed {
    border-color: var(--warning);
  }

  .sys-btn.armed span {
    color: var(--warning);
  }
</style>
