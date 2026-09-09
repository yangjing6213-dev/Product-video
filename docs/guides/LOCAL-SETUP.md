# Windows Local Setup

`scripts/setup-local.mjs` prepares or verifies the pinned Windows x64 tools inside this repository. It does not modify the system, does not require administrator access, does not install global packages, and does not change PATH or the registry.

The currently verified platform is Windows x64. A fresh clone must have Node.js 24.15+ and npm available outside this repository before any repository-local fallback can exist. Install the pinned dependencies first:

```powershell
npm ci
```

## Commands

After repository-local npm dependencies exist, run:

```powershell
node scripts/setup-local.mjs
```

This downloads only a missing pinned Chrome archive or FFmpeg gzip. Existing executables are verified in place and never downloaded again. To prohibit all downloads and perform read-only tool verification:

```powershell
node scripts/setup-local.mjs --verify-only
```

Some existing local workspaces may already contain this ignored repository-local npm fallback:

```powershell
node .tools/npm/bin/npm-cli.js ci
```

The `.tools/npm` directory is not part of a clone and is not downloaded by `setup-local.mjs`. Use it only when it already exists and has been independently prepared; a fresh clone still needs npm from the host environment for the initial `npm ci`.

The script refuses to overwrite an existing `.tools/environment.json` whose required paths differ. It also refuses to extract over an existing partial Chrome directory or overwrite an existing executable. Resolve such a conflict manually after inspecting the files; the script performs no cleanup or deletion.

## Pinned sources and integrity

| Tool | Source | Source integrity | Installed verification |
|---|---|---|---|
| Chrome Headless Shell `152.0.7977.30` | `https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.30/win64/chrome-headless-shell-win64.zip` | ZIP SHA-256 `5d7df999a6e4a65a1b16b25b61064f7337b8aa8ee2ed1b4e07bfdd24f6e4275e` | Exact version plus executable SHA-256 |
| FFmpeg `6.1.1` | `https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/316528798` with `Accept: application/octet-stream` | gzip SHA-256 `8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77` | Exact version plus decompressed executable SHA-256 |
| FFprobe `4.0.2` | pinned package `ffprobe-static@3.1.0` | npm lockfile | Exact version plus executable SHA-256 |
| HyperFrames `0.8.33` | pinned npm dependency | npm lockfile | Exact CLI version plus `doctor --json` |

Chrome is extracted to `.tools/chrome/chrome-headless-shell-win64/chrome-headless-shell.exe`. FFmpeg is stored as `.tools/ffmpeg-6.1.1.exe`. FFprobe remains under `node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe`. Downloads and executables remain ignored local artifacts.

## Environment file

On the first compatible setup, the script creates `.tools/environment.json` and `.cache/frames`:

```json
{
  "HYPERFRAMES_BROWSER_PATH": "<repo>\\.tools\\chrome\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
  "HYPERFRAMES_FFMPEG_PATH": "<repo>\\.tools\\ffmpeg-6.1.1.exe",
  "HYPERFRAMES_FFPROBE_PATH": "<repo>\\node_modules\\ffprobe-static\\bin\\win32\\x64\\ffprobe.exe",
  "HYPERFRAMES_EXTRACT_CACHE_DIR": "<repo>\\.cache\\frames"
}
```

Existing matching configuration is read and verified without rewriting it. The application loads these values only for child tool processes; system and user environment variables are unchanged.

## Evidence and optional capabilities

The command prints one JSON report containing:

- observed versions and SHA-256 values;
- whether each tool was installed or verified-existing;
- the actual HyperFrames version and `doctor --json` command evidence;
- core failures and separately listed optional unavailable checks;
- whether local `narrationMode=none` rendering prerequisites are ready.

Missing Whisper, Kokoro TTS, MusicGen, Docker, or Docker runtime is recorded as optional and does not block the local `narrationMode=none` path. It does prevent claiming those optional capabilities are available. Any missing Chrome, FFmpeg, FFprobe, Node, HyperFrames, cache, memory, disk, or other required doctor check remains blocking.

The pinned FFmpeg and FFprobe builds report GPL-enabled configurations. They are used only for private local execution in this MVP and are not redistributed from the repository. Review licensing separately before any later binary redistribution or public packaging.
