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
- `lib/bridge/adb.ts` — All device control. `Capacitor.isNativePlatform()` switches between `ShellExec.exec()` (native) and mock responses (web)
- `lib/plugins/shell-exec.ts` — Capacitor ShellExec plugin interface
- `lib/stores/device.svelte.ts` — Device, display, recording, game profile state + interfaces
- `lib/stores/navigation.svelte.ts` — Tab state
- `lib/stores/persistence.ts` — localStorage: presets, profiles, scripts, app configs

**UI components** (`lib/components/ui/`): Card, Button, Slider, Toggle, LevelPicker, FrequencyPicker, AppPicker — use `$props()` with `$bindable()`.

## Conventions

- Dark theme via CSS custom properties in `app.css` (primary: `#22d98e`, bg: `#080a10`)
- Fonts: Sora (headings), Outfit (body), Space Mono (values/code)
- Scoped `<style>` blocks; global vars on `:root`
- State: runes in `.svelte.ts` files, never legacy Svelte stores
- App ID: `com.ocularmigraine.mcp`, webDir: `dist/`
