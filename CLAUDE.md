# The Ocular Migraine: Revisualized

Svelte 5 + Capacitor app for managing Meta Quest headsets (1/2/3/Pro) via ADB `debug.oculus.*` properties. Runs on-device as Android app or in browser with mock ADB.

## Commands

```bash
bun run dev            # Vite dev server (:5173)
bun run build          # Production build → dist/
bun run check          # Svelte type checking
bun run build:android  # Build + cap sync
bun run apk:debug      # Build + sync + assembleDebug
bun run install:quest  # adb install debug APK
./deploy.sh            # All-in-one build + deploy
```

## Architecture

**Routing**: No router. `App.svelte` conditionally renders 3 views (tune, recording, system) via `getActiveTab()`. Tune is the landing page with performance controls front-and-center. System absorbs the old Apps tab via section tabs.

**State**: Svelte 5 runes (`$state`/`$derived`) in `.svelte.ts` files with getter/setter exports — not Svelte stores.

**Key modules**:
- `lib/bridge/adb.ts` — All device control, across three routes: `native` (ShellExec on the headset), `desktop` (`server.ts` proxying `adb shell`) and `mock` (fixtures in the browser)
- `lib/bridge/capabilities.ts` — The second axis: what a route may actually *do*. `native` starts at privilege `app` and is promoted to `shell` only by a probe that writes a prop and reads it back
- `lib/plugins/shell-exec.ts` — Interfaces for all five Capacitor plugins: ShellExec, DeviceInfo, Apps, FileServer, Video
- `lib/i18n/en.ts` — Every user-facing string, and the source of truth for the key type
- `lib/stores/device.svelte.ts` — Device, display, recording, game profile state + interfaces
- `lib/stores/navigation.svelte.ts` — Tab state
- `lib/stores/persistence.ts` — localStorage: presets, profiles, scripts, app configs

**UI components** (`lib/components/ui/`): Card, Button, Slider, Toggle, LevelPicker, FrequencyPicker, AppPicker, CapabilityMatrix, ConnectionIndicator, Toast — use `$props()` with `$bindable()`. `components/setup/SetupWizard.svelte` is the two-step unlock flow.

**Native side** (`android/app/src/main/java/com/ocularmigraine/mcp/`): a hand-written ADB client (`adb/`) that unlocks the headset over loopback, `LaunchWatcherService` (applies a game profile when that game starts), `FileServer` + `SafePath` (share a folder over HTTP), `Mp4Stereo` (marks a capture as 3D), `BootLaunchReceiver` + `StartupLauncher` (open an app after a restart). `SafePath` and `Mp4Stereo` have no Android imports and carry a `main()`, so both run on a desktop JVM.

## Conventions

- Dark theme via CSS custom properties in `app.css` (primary: `#22d98e`, bg: `#080a10`)
- Fonts: Sora (headings), Outfit (body), Space Mono (values/code)
- Scoped `<style>` blocks; global vars on `:root`
- State: runes in `.svelte.ts` files, never legacy Svelte stores
- App ID: `com.ocularmigraine.mcp`, webDir: `dist/`
