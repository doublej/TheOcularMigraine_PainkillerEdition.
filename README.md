![The Ocular Migraine — Painkiller Edition](docs/static/label.png)

# The Ocular Migraine: Painkiller Edition

A native Android app for managing Meta Quest VR headsets (Quest 1/2/3/Pro). Controls device settings via ADB shell commands — resolution, refresh rate, CPU/GPU levels, recording, app management, and more.

## Credits

The Ocular Migraine was created by [petermg](https://github.com/petermg/TheOcularMigraineMCP). All credit for the concept, feature design, ADB command research, and the exhaustive work mapping every Quest setting to its `debug.oculus.*` property goes to him. His original Tasker-based app is genuinely one of the most feature-complete Quest management tools out there — it does things no other app bothers to do.

This fork is a UI rebuild using Svelte 5 + Capacitor. Most of his feature set is here, rebuilt against the same ADB surface; the list below says exactly which parts are and are not.

The mark above is an homage to his banner art, not a replacement for it: his vesica eye and his blazing core, with the sunburst redrawn as a fortification spectrum — the shape an ocular migraine aura actually takes. `tools/gen-icons.py` renders it into every icon and splash screen; `tools/label.html` is the source of the label itself.

## Features

- Change headset resolution — rungs relative to the panel the headset reports, or custom
- Change CPU level (0–5), static or dynamic
- Change GPU level (0–5), static or dynamic
- Change Fixed Foveated Rendering level (0–4), static or dynamic
- Change refresh rate — only the rates the display itself reports
- Game profiles — saved per game and applied when that game starts
- Recording controls — resolution, bitrate, framerate, eye selection, FOV crop
- Mark a both-eyes recording as 3D, so it uploads to YouTube as stereo
- App management — install APKs, single app mode, startup app, access control lists
- Web server for sharing a folder over HTTP, with optional uploads
- ADB console for direct shell access, with saved commands
- Settings backup and restore, and a capability matrix that says what this headset allows

The unlock needs a computer once. After that the headset reopens its own ADB port at every
boot, so all it wants on later restarts is the "Allow debugging?" prompt — no computer, no cable.

## Not ported from the original

petermg's app does these and this one does not:

- Game backup and restore — APK, OBB and `/sdcard/Android/data`, including the Windows restore script
- Stereo audio recording on Quest 2 and 3
- Video editing — audio offset, tempo, and trimming the start and end
- Redirect apps that put unknown-sources titles in the headset's own menu
- A password on single app mode, and preventing exit from the locked app
- Installing OVR Metrics Tool and driving its overlay (this app can only launch it)

## Tech Stack

- **Svelte 5** with runes for reactive state
- **Capacitor 8** for native Android wrapping
- **Vite 6** for builds
- Custom **ShellExec** Capacitor plugin using `Runtime.exec()` for on-device shell commands

## Development

```bash
bun run dev      # Start dev server (localhost:5173)
bun run build    # Production build
bun run check    # Type checking
./deploy.sh      # Build + deploy to Quest via Windows relay
```

## License

See [LICENSE.txt](LICENSE.txt).
