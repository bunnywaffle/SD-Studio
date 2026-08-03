# SD.cpp Studio

An Electron desktop app for managing the [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) server (`sd-server`). Install a backend release, load models/LoRAs, and generate images with a prompt, negative prompt, steps, CFG, sampler, scheduler, and seed — all in one window.

## Features

- **Backend manager** — three ways to set up `sd-server`: import a release ZIP, download the latest release from GitHub, or **link an already-extracted backend folder** directly (no copying). Backend setup lives in the **Settings** dialog (gear icon), keeping the main UI focused on generation.
- **Folder-based models** — point the app at one model folder; it auto-detects models, LoRAs, VAEs, and text encoders from a fixed subfolder layout (`models/`, `loras/`, `vae/`, `text_encoders/`). The app can create the structure for you (one click, or at the default location).
- **Image editing (img2img)** — a **Generate / Edit image** toggle on the main screen. In Edit mode, load any image and describe the change in the prompt (e.g. "make it rainy and moody"); a strength slider (0–1) controls how much the original is kept. Sent to the server as native `init_image` + `strength`.
- **Server control** — start/stop with auto-built args (`--listen-ip`, `--listen-port`, `--diffusion-model`, `--vae`, `--llm`, `--lora-model-dir`, extra args) and live server log output.
- **Model pickers on the main screen** — collapsible **Models** card on the left picks the diffusion model, text encoder, and VAE. LoRAs are stacked as multiple slots, each with its own picker and a **strength slider** (0–2) — use "+ Add LoRA" to stack more. The server log is collapsible too.
- **Generation** — prompt / negative prompt / steps / CFG / sampler / scheduler / seed / batch; gallery with click-to-preview and save to disk.
- **Image size** — two modes: manual W×H, or **aspect ratio + megapixels** (default 1 MP) which auto-computes pixel dimensions (snapped to multiples of 8). Presets include 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9, plus custom ratios.
- **Style templates** — a style wraps your prompt with template text (via a `{prompt}` placeholder) and appends a negative prompt. Styles are defined in an editable `styles.json` file that only contains prompt + negative_prompt.
- **Progress** — live server-status badge and per-job progress via the native `/sdcpp/v1` API (with `/sdapi/v1` fallback).
- Cross-platform packaging via electron-builder (Windows NSIS/portable, macOS DMG, Linux AppImage/deb).

## Requirements

- Node.js 20+ (developed against Node 24)
- npm
- Electron 31 (installed via npm)
- A model file (`.gguf` or `.safetensors` + `--diffusion-model`) for actual image generation

## Getting started

```bash
npm install
npm start
```

### Setting up a backend

Pick one of three ways in **Settings** (gear icon) → **Install Backend**:

1. **Download Latest Release** — fetches the newest stable-diffusion.cpp build from GitHub.
2. **Import release ZIP** — installs a zip you already have.
3. **Link extracted backend folder** — point the app at a folder that already contains `sd-server` (e.g. `C:\...\sd-master-eb7f35c-bin-win-cuda12-x64`). The app uses it directly without copying.

Configure host/port/extra args in the same dialog.

### Setting up your model folder

1. Open **Settings** (gear icon) → **Models**. Click **Browse** to choose a folder, or **Use default location** to create one at `Documents/SD.cpp Studio/models`.
2. Click **Create structure** (or it's done automatically with *Use default location*). This creates:

```
<your folder>/
  models/           <- diffusion models (*.safetensors, *.gguf, *.ckpt, ...)
  loras/            <- LoRA weights
  vae/              <- VAE files
  text_encoders/    <- text encoder / CLIP models (--llm)
```

3. Drop your files into the matching subfolders. The app auto-detects them (dots next to each subfolder turn green when files are found) and populates the **Diffusion model**, **VAE**, and **Text encoder** pickers on the main screen.
4. Select which model/VAE/text encoder to use, then **Start Server**.

> `.gguf`/`.bin` models are passed via `-m` (unified model); `.safetensors`/`.ckpt`/`.pth`/`.pt` via `--diffusion-model`. LoRAs in `loras/` are selectable from the LoRA slots on the main screen, each with its own strength slider.

## Model type note

All diffusion model files (`.gguf`, `.safetensors`, `.ckpt`, `.pth`, `.pt`, `.bin`) are launched with `--diffusion-model`. This is the flag stable-diffusion.cpp requires for FLUX-family models — it prepends the `model.diffusion_model.` tensor prefix when loading, which is how the model type is detected. `--vae`, `--llm`, and `--lora-model-dir` come from the `vae/`, `text_encoders/`, and `loras/` subfolders.

## Progress

While a job runs, a progress card under the Generate button shows the live state: **Queued (queue position)** → **Generating** (animated bar). When the server logs sampling progress (e.g. `3/20` or `45%`), the bar fills to the reported percentage. It hides when the job completes, fails, or is cancelled.

## Runtime & GPU detection

The **Settings → Runtime & GPU** card tells you what your machine can actually use, and fixes missing pieces automatically:

- **Platform** — OS + architecture.
- **GPU** — every detected adapter, with vendor and VRAM (accurate VRAM comes from `nvidia-smi` where available).
- **Backend build** — which stable-diffusion.cpp variant is linked: CUDA, Vulkan, ROCm, Metal, or CPU-only (detected from the backend folder's `ggml-*.dll/.so` files).
- **Devices** — what `sd-server --list-devices` reports, i.e. whether generation will actually use the GPU.
- **Runtime files** — the app scans the PE imports of every `.exe`/`.dll` next to the server and reports libraries that are missing on the machine.

If a real GPU is present but `sd-server` only sees a CPU device (a missing CUDA/Vulkan runtime), the card shows a warning and a **Download missing** button. For CUDA builds it fetches the matching CUDA runtime (`cudart64_12.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`, ...) from NVIDIA's official redist archive and places them next to the server binary, then re-checks. The detection is cross-platform (Windows / Linux / macOS); automatic downloads currently cover the CUDA runtime on Windows.

## Config file

Settings are stored as JSON at `app.getPath('userData')/settings.json`:

```json
{
  "backendDir": "C:/Users/you/AppData/Roaming/SD.cpp Studio/backends",
  "modelDir": "C:/Users/you/Documents/SD.cpp Studio/models",
  "modelPath": "",
  "diffusionModelPath": "",
  "vaePath": "",
  "textEncoderPath": "",
  "loraDir": "C:/Users/you/Documents/SD.cpp Studio/models/loras",
  "listenHost": "127.0.0.1",
  "listenPort": 1234,
  "extraArgs": "",
  "autoStartServer": false,
  "sizeMode": "manual",
  "ratioPreset": "16:9",
  "ratioW": 16,
  "ratioH": 9,
  "megapixels": 1.0,
  "width": 512,
  "height": 512,
  "selectedStyle": "",
  "steps": 20,
  "cfgScale": 7,
  "seed": -1,
  "batchCount": 1,
  "sampler": "euler_a",
  "scheduler": "discrete",
  "outputFormat": "png",
  "theme": "neutral"
}
```

Generation parameters (steps, CFG, seed, batch, sampler, scheduler, output format) auto-save whenever you change them, so the app restores your last-used values on the next launch. The **Save** button in the Settings dialog persists every field to this JSON explicitly.

## Themes

The UI is a CSS-variable theme system. On first launch the app copies the bundled theme files into the user-data `themes` folder, where they are plain CSS and fully user-editable.

- **Settings → Theme** lists available themes (`neutral`, `dark`, `light` by default).
- Click **Open themes folder** to edit/add CSS files; click **Reload** to apply changes without restarting.
- Any `*.css` file you drop into the themes folder appears in the dropdown. Themes just redefine the same CSS variables, e.g.:

```css
:root {
    --bg: #1a1a1a;
    --bg-panel: #222222;
    --bg-card: #2a2a2a;
    --text: #e8e8e8;
    --accent: #8a8a8a;
}
```

The bundled `themes/neutral.css` contains the complete variable list — copy it as a starting point for your own theme.

## Style templates (`styles.json`)

Style presets are driven by a JSON file. On first launch the app copies the bundled `styles.json` into the user-data directory so you can freely edit it.

- Click **Edit JSON** in the UI to open the active `styles.json` in your default editor.
- Click **Reload** to re-read it (no restart needed).
- Each style is just two fields — `prompt` and `negative_prompt`:

```json
{
  "name": "My Style",
  "prompt": "in style of my style, {prompt}, extra keywords",
  "negative_prompt": "avoid this, and this"
}
```

- In `prompt`, use the `{prompt}` placeholder where your own prompt goes; if you omit it, the template is simply prepended to your prompt.
- The style's `negative_prompt` is appended to your negative prompt.
- Add entries to the `styles` array to add styles; remove entries to drop them. The `None` entry is a built-in no-op.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Launch the app |
| `npm run dist` | Build installers via electron-builder |
| `SDCPP_SMOKE=1 npm start` | Headless smoke test (checks preload bridge + app state) |
| `SDCPP_E2E=1 npm start` | E2E check against a mock sd-server (requires `mock-server.js` running on port 7777) |

## Packaging

```bash
npm run dist
```

Output goes to `release/`. On Windows this produces `SD.cpp Studio Setup 1.0.0.exe` (NSIS) and `SD.cpp Studio 1.0.0.exe` (portable). Add `--mac --win --linux` flags or run per-OS for others. Note: `electron-builder` downloads platform binaries at package time.

## Project layout

```
main.js                 App lifecycle, window, IPC handlers, smoke/E2E hooks
preload.js              contextIsolation bridge -> window.sdcpp.*
src/settings.js         Persistent settings store
src/models.js           Folder-based model detection (models/loras/vae/text_encoders)
src/styles.js           Style-template loader (styles.json, user-data copy)
src/releases.js         GitHub release/asset listing + classification
src/backend.js          BackendManager: download/extract/validate/spawn sd-server
src/api.js              HTTP client for /sdcpp/v1 and /sdapi/v1
src/themes.js           Theme loader: seed/read user-editable theme css from user-data
styles.json             Bundled style templates (copied to user-data on first run)
themes/                 Bundled user-editable themes (neutral, dark, light)
renderer/index.html     UI markup
renderer/styles.css     Styling (neutral default; all colors as CSS variables)
renderer/renderer.js    UI logic, generation flow, size/ratio, styles, models, gallery
```

## API notes

- Native flow uses `POST /sdcpp/v1/img_gen` → `GET /sdcpp/v1/jobs/{id}` polling, with `capabilities` supplying sampler/scheduler names and defaults.
- Fallback flow uses `POST /sdapi/v1/txt2img` (A1111-style) when the native endpoint is unavailable.
- LoRAs are sent as structured `lora[]` entries (`path`, `multiplier`), not prompt tags.
