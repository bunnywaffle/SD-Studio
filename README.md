# SD.cpp Studio

An Electron desktop app for managing the [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) server (`sd-server`). Install a backend release, load models/LoRAs, and generate images with a prompt, negative prompt, steps, CFG, sampler, scheduler, and seed — all in one window.

## Features

- **Backend manager** — three ways to set up `sd-server`: import a release ZIP, download the latest release from GitHub, or **link an already-extracted backend folder** directly (no copying). Backend setup lives in the **Settings** dialog (gear icon), keeping the main UI focused on generation.
- **Folder-based models** — point the app at one model folder; it auto-detects models, LoRAs, VAEs, and text encoders from a fixed subfolder layout (`models/`, `loras/`, `vae/`, `text_encoders/`). The app can create the structure for you (one click, or at the default location).
- **Import from any folder (symlink)** — a **Link file** picker on the main screen imports a model/LoRA/VAE/text encoder from anywhere on disk: the app links the file into the right subfolder (symlink; falls back to a hard link on the same drive), scans it into the pickers, and auto-selects it. No copying, no re-arranging your existing downloads.
- **Image editing (reference-image)** — a **Generate / Edit image** toggle on the main screen. In Edit mode, load any image and describe the change in the prompt (e.g. "make it rainy and moody"); a strength slider (0–1) is passed through. Sent to the server as native `ref_images[]`, which is the universal mechanism for **every** supported edit model (FLUX.2, FLUX Kontext, Qwen Image Edit/Layered, LongCat, Boogu, Krea2, Mage-Flow, Anima, instruct-pix2pix, ...). The server auto-selects the right `--ref-image-args` preset from the model architecture; VLM-based models (Qwen Edit, LongCat, Boogu, Krea2, Mage-Flow) additionally need a **Vision encoder** selected (an mmproj file in `text_encoders/`), and an advanced **Ref-image args** field is available to override the preset (`preset=qwen_layered`).
- **Server control** — start/stop with auto-built args (`--listen-ip`, `--listen-port`, `--diffusion-model`, `--vae`, `--llm`, `--llm_vision`, `--ref-image-args`, `--lora-model-dir`, extra args) and live server log output.
- **Model pickers on the main screen** — collapsible **Models** card on the left picks the diffusion model, text encoder, vision encoder, and VAE. LoRAs are stacked as multiple slots, each with its own picker and a **strength slider** (0–2) — use "+ Add LoRA" to stack more. The server log is collapsible too.
- **Generation** — prompt / negative prompt / steps / CFG / sampler / scheduler / seed / batch; gallery with click-to-preview and save to disk.
- **Image size** — two modes: manual W×H, or **aspect ratio + megapixels** (default 1 MP) which auto-computes pixel dimensions (snapped to multiples of 8). Presets include 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9, plus custom ratios.
- **Style templates** — a style wraps your prompt with template text (via a `{prompt}` placeholder) and appends a negative prompt. Styles are defined in an editable `styles.json` file that only contains prompt + negative_prompt.
- **Progress** — live server-status badge and per-job progress via the native `/sdcpp/v1` API (with `/sdapi/v1` fallback).
- Cross-platform packaging via electron-builder (Windows NSIS/portable, macOS DMG, Linux AppImage/deb).

## Requirements

- Node.js 20+ (developed against Node 24)
- npm
- Electron 31 (installed via npm)
- A model file for actual image generation — any supported weight format: `.gguf`, `.safetensors`, `.ckpt`, `.pth`, or `.pt`

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
  text_encoders/    <- text encoder / CLIP models (--llm), and vision encoders / mmproj (--llm_vision)
```

3. Drop your files into the matching subfolders. The app auto-detects them (dots next to each subfolder turn green when files are found) and populates the **Diffusion model**, **VAE**, **Text encoder**, and **Vision encoder** pickers on the main screen. Files in `text_encoders/` whose name looks like a vision model (contains `mmproj`, `vision`, `vl`, ...) are offered in the **Vision encoder** picker.
4. Select which model/VAE/text encoder to use, then **Start Server**.

### Importing files from anywhere (no re-arranging)

Don't want to copy a model into the folder structure? Use **Models → Link file** on the main screen:

1. Pick the type (**Diffusion model / LoRA / VAE / Text encoder / Vision encoder**).
2. Click **Link file…** and choose the file anywhere on disk (`.gguf`, `.safetensors`, etc.).
3. The app links it into the matching subfolder — a **symlink** (needs Developer Mode/admin on Windows), falling back to a **hard link** if it's on the same drive. It then appears in the pickers and is auto-selected, no copying or moving required.

> Keep the linked file where it is; only the link lives in the models folder. If a link can't be created (e.g. cross-drive without Developer Mode), the app tells you what to enable.

> `.safetensors`/`.ckpt`/`.pth`/`.pt` are passed via `-m` (unified loader); `.gguf`/`.bin` via `--diffusion-model`. LoRAs in `loras/` are selectable from the LoRA slots on the main screen, each with its own strength slider.

## Model weight formats

stable-diffusion.cpp supports three weight formats, and the app detects and launches all of them — the **Diffusion model** picker lists every file in `models/` regardless of format, and the launch flag is chosen automatically from the file extension:

| Format | Launch flag |
| :--- | :--- |
| GGUF (`.gguf`) / `.bin` | `--diffusion-model` |
| Safetensors (`.safetensors`) | `-m` (unified loader) |
| Pytorch checkpoint (`.ckpt`, `.pth`, `.pt`) | `-m` (unified loader) |

GGUF files carry architecture metadata and go through `--diffusion-model` (the proven path for FLUX-family gguf). Raw Pytorch / Safetensors checkpoints use the unified `-m` loader, which auto-detects the architecture from the weights — exactly how the upstream `sd-cli -m model.safetensors` quickstart works. `--vae`, `--llm`, `--llm_vision`, and `--lora-model-dir` come from the `vae/`, `text_encoders/`, and `loras/` subfolders.

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
  "visionEncoderPath": "",
  "refImageArgs": "",
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
src/models.js           Folder-based model detection (models/loras/vae/text_encoders, incl. vision encoders)
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
- Edit mode sends the loaded image as `ref_images[]` (with `auto_resize_ref_image`/`increase_ref_index`), not `init_image`. This one payload works across all edit model families; the server picks the ref-image preset (`--ref-image-args`) from the model, optionally overridden via the **Ref-image args** setting. Vision-encoder-required models use the selected **Vision encoder** (`--llm_vision`).
