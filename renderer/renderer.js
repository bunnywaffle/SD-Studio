'use strict';

const api = window.sdcpp;

// ---------- Element cache ----------
const el = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    serverUrl: document.getElementById('serverUrl'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),

    serverBinary: document.getElementById('serverBinary'),
    btnBrowseServer: document.getElementById('btnBrowseServer'),
    listenHost: document.getElementById('listenHost'),
    listenPort: document.getElementById('listenPort'),
    extraArgs: document.getElementById('extraArgs'),
    refImageArgs: document.getElementById('refImageArgs'),
    autoStart: document.getElementById('autoStart'),
    btnImportZip: document.getElementById('btnImportZip'),
    btnDownloadLatest: document.getElementById('btnDownloadLatest'),
    btnLinkFolder: document.getElementById('btnLinkFolder'),
    downloadArea: document.getElementById('downloadArea'),
    downloadLabel: document.getElementById('downloadLabel'),
    assetList: document.getElementById('assetList'),
    progressWrap: document.getElementById('progressWrap'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    logBox: document.getElementById('logBox'),

    btnSettings: document.getElementById('btnSettings'),
    settingsModal: document.getElementById('settingsModal'),
    btnSettingsClose: document.getElementById('btnSettingsClose'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    backendAlert: document.getElementById('backendAlert'),

    dataDirInput: document.getElementById('dataDirInput'),
    btnDataDirChange: document.getElementById('btnDataDirChange'),
    btnDataDirReset: document.getElementById('btnDataDirReset'),
    btnDataDirOpen: document.getElementById('btnDataDirOpen'),
    dataMigrateWrap: document.getElementById('dataMigrateWrap'),
    dataMigrateFill: document.getElementById('dataMigrateFill'),
    dataMigrateText: document.getElementById('dataMigrateText'),

    themeSelect: document.getElementById('themeSelect'),
    btnThemeOpen: document.getElementById('btnThemeOpen'),
    btnThemeReload: document.getElementById('btnThemeReload'),

    btnRuntimeCheck: document.getElementById('btnRuntimeCheck'),
    btnRuntimeFixAll: document.getElementById('btnRuntimeFixAll'),
    runtimeInfo: document.getElementById('runtimeInfo'),
    runtimeProgressWrap: document.getElementById('runtimeProgressWrap'),
    runtimeProgressFill: document.getElementById('runtimeProgressFill'),
    runtimeProgressText: document.getElementById('runtimeProgressText'),

    genProgressCard: document.getElementById('genProgressCard'),
    genProgressFill: document.getElementById('genProgressFill'),
    genProgressText: document.getElementById('genProgressText'),

    modelDirInput: document.getElementById('modelDirInput'),
    btnModelDirBrowse: document.getElementById('btnModelDirBrowse'),
    btnModelDirCreate: document.getElementById('btnModelDirCreate'),
    btnModelDirDefault: document.getElementById('btnModelDirDefault'),
    btnModelDirOpen: document.getElementById('btnModelDirOpen'),
    selModel: document.getElementById('selModel'),
    selTextEncoder: document.getElementById('selTextEncoder'),
    selVisionEncoder: document.getElementById('selVisionEncoder'),
    selVae: document.getElementById('selVae'),
    loraDirInput: document.getElementById('loraDirInput'),
    loraApplyMode: document.getElementById('loraApplyMode'),
    linkModelType: document.getElementById('linkModelType'),
    btnLinkModelFile: document.getElementById('btnLinkModelFile'),

    prompt: document.getElementById('prompt'),
    negativePrompt: document.getElementById('negativePrompt'),
    btnClearPrompt: document.getElementById('btnClearPrompt'),
    styleSelect: document.getElementById('styleSelect'),
    stylePickerBtn: document.getElementById('stylePickerBtn'),
    stylePickerLabel: document.getElementById('stylePickerLabel'),
    stylePopover: document.getElementById('stylePopover'),
    stylePopoverSearch: document.getElementById('stylePopoverSearch'),
    styleList: document.getElementById('styleList'),
    btnStyleReload: document.getElementById('btnStyleReload'),
    btnStyleOpen: document.getElementById('btnStyleOpen'),
    steps: document.getElementById('steps'),
    cfgScale: document.getElementById('cfgScale'),
    width: document.getElementById('width'),
    height: document.getElementById('height'),
    sizeMode: document.getElementById('sizeMode'),
    sizeManual: document.getElementById('sizeManual'),
    sizeRatio: document.getElementById('sizeRatio'),
    ratioPreset: document.getElementById('ratioPreset'),
    ratioCustom: document.getElementById('ratioCustom'),
    ratioW: document.getElementById('ratioW'),
    ratioH: document.getElementById('ratioH'),
    megapixels: document.getElementById('megapixels'),
    computedSize: document.getElementById('computedSize'),
    batchCount: document.getElementById('batchCount'),
    seed: document.getElementById('seed'),
    btnRandomSeed: document.getElementById('btnRandomSeed'),
    sampler: document.getElementById('sampler'),
    scheduler: document.getElementById('scheduler'),
    outputFormat: document.getElementById('outputFormat'),

    loraSlots: document.getElementById('loraSlots'),
    btnAddLora: document.getElementById('btnAddLora'),

    btnGenerate: document.getElementById('btnGenerate'),
    btnCancel: document.getElementById('btnCancel'),
    genStatus: document.getElementById('genStatus'),

    modeGenerate: document.getElementById('modeGenerate'),
    modeEdit: document.getElementById('modeEdit'),
    editPanel: document.getElementById('editPanel'),
    btnLoadImage: document.getElementById('btnLoadImage'),
    btnClearImage: document.getElementById('btnClearImage'),
    editPreview: document.getElementById('editPreview'),
    editStrength: document.getElementById('editStrength'),
    editStrengthVal: document.getElementById('editStrengthVal'),

    gallery: document.getElementById('gallery'),
    btnClearGallery: document.getElementById('btnClearGallery'),
    btnOpenGalleryDir: document.getElementById('btnOpenGalleryDir'),

    modelManagerModal: document.getElementById('modelManagerModal'),
    btnOpenModelManager: document.getElementById('btnOpenModelManager'),
    btnManagerClose: document.getElementById('btnManagerClose'),
};

// ---------- State ----------
let backendState = { status: 'stopped', logs: [] };
let settings = {};
let capabilities = null;
let loraSlots = [];
let activeJob = null;
let pollTimer = null;
let galleryItems = [];
let galleryDir = null;
let styles = [];
let themesAvailable = [];
let modelsState = null;
let editMode = false;
let initImage = null; // { name, dataUrl, width, height }
let payloadForLastJob = null;

// ---------- Utils ----------
function fmtBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function logLine(entry) {
    const div = document.createElement('div');
    div.className = `log-line ${entry.level || ''}`;
    const time = new Date(entry.ts).toLocaleTimeString();
    div.textContent = `[${time}] ${entry.message}`;
    el.logBox.appendChild(div);
    el.logBox.scrollTop = el.logBox.scrollHeight;
}

function setStatus(status, text) {
    el.statusDot.className = `status-dot ${status}`;
    el.statusText.textContent = text || status;
    const online = status === 'running';
    el.btnStart.disabled = online;
    el.btnStop.disabled = !online && status !== 'starting';
}

function convLogMessages(logs) {
    return (logs || []).map((e) => String(e.message || '').toLowerCase());
}

function describeBackendError(state) {
    const msgs = convLogMessages(state.logs).join('\n');
    if (/unsupported dtype/.test(msgs)) {
        return 'The model file uses a quantization dtype this backend build does not support (e.g. I8). Try a different model variant (plain .gguf / .safetensors, not an int4/convrot quant), or update to a newer stable-diffusion.cpp release.';
    }
    if (/get sd version from file failed/.test(msgs)) {
        return 'The diffusion model file could not be identified. It is either not a GGUF made for stable-diffusion.cpp, or it needs to be selected in Settings.';
    }
    if (/no diffusion model selected/.test(msgs)) {
        return 'No diffusion model is selected. Open Settings, pick a model from the "Diffusion model" list, then start the server again.';
    }
    if (/no sd-server found/.test(msgs)) {
        return 'The backend (sd-server) is not installed or linked yet. Open Settings to install or import a stable-diffusion.cpp release first.';
    }
    if (/model metadata validation failed|has wrong shape in model metadata/.test(msgs)) {
        return 'The text encoder file does not match the model. It may be an FP8-scale or vision file. Settings pick a plain text-encoder file (e.g. Qwen3) and retry.';
    }
    if (/failed to open|no such file|file not found|can't open|cannot open/.test(msgs)) {
        return 'A required model file could not be opened. The path may be missing or wrong. Check the Models folder in Settings.';
    }
    if (/cuda|cublas|cudnn/i.test(msgs)) {
        return 'The backend had an error with your GPU (CUDA). Check that this build supports your GPU, or try a CPU build.';
    }
    return 'The server could not start. Open the Server Log card below for the technical details.';
}

function renderBackendState() {
    const state = backendState;
    setStatus(state.status, state.status === 'running' ? 'Online' : state.status === 'starting' ? 'Starting...' : state.status === 'error' ? 'Error' : 'Offline');
    if (state.runningUrl) {
        el.serverUrl.textContent = state.runningUrl;
        el.serverUrl.hidden = false;
    } else {
        el.serverUrl.hidden = true;
    }
    if (state.serverPath) {
        el.serverBinary.value = state.serverPath;
    }
    if (state.status === 'error') {
        el.backendAlert.hidden = false;
        el.backendAlert.textContent = '⚠ ' + describeBackendError(state);
    } else {
        el.backendAlert.hidden = true;
    }
}

function setBusy(busy) {
    el.btnGenerate.disabled = busy;
    el.btnCancel.disabled = !busy;
}

function setGenStatus(text, cls) {
    el.genStatus.textContent = text || '';
    el.genStatus.className = `gen-status ${cls || ''}`;
}

// ---------- Image size (manual vs aspect ratio) ----------
const RATIO_PRESETS = [
    { label: '1:1', w: 1, h: 1 },
    { label: '4:3', w: 4, h: 3 },
    { label: '3:4', w: 3, h: 4 },
    { label: '3:2', w: 3, h: 2 },
    { label: '2:3', w: 2, h: 3 },
    { label: '16:9', w: 16, h: 9 },
    { label: '9:16', w: 9, h: 16 },
    { label: '21:9', w: 21, h: 9 },
];

function snapTo8(v) {
    return Math.max(8, Math.round(v / 8) * 8);
}

function clampSize(v) {
    return Math.min(4096, Math.max(64, v));
}

function getCurrentRatio() {
    const preset = RATIO_PRESETS.find((p) => p.label === el.ratioPreset.value);
    if (preset) return { w: preset.w, h: preset.h };
    const w = parseInt(el.ratioW.value, 10) || 1;
    const h = parseInt(el.ratioH.value, 10) || 1;
    return { w: Math.max(1, w), h: Math.max(1, h) };
}

function applySizeMode() {
    const mode = el.sizeMode.value;
    el.sizeManual.hidden = mode !== 'manual';
    el.sizeRatio.hidden = mode !== 'ratio';
    if (mode === 'ratio') {
        el.ratioCustom.hidden = el.ratioPreset.value !== 'custom';
    }
    updateComputedSize();
}

function syncRatioFields() {
    const preset = RATIO_PRESETS.find((p) => p.label === el.ratioPreset.value);
    if (preset) {
        el.ratioW.value = preset.w;
        el.ratioH.value = preset.h;
    }
    el.ratioCustom.hidden = el.ratioPreset.value !== 'custom';
    updateComputedSize();
}

function updateComputedSize() {
    if (el.sizeMode.value !== 'ratio') {
        el.computedSize.textContent = '';
        return;
    }
    const mp = parseFloat(el.megapixels.value) || 1.0;
    const { w, h } = getCurrentRatio();
    const total = mp * 1000000;
    const width = clampSize(snapTo8(Math.sqrt(total * w / h)));
    const height = clampSize(snapTo8(Math.sqrt(total * h / w)));
    el.computedSize.textContent = `→ ${width} × ${height} px @ ${mp} MP (${w}:${h})`;
}

function computeEffectiveSize() {
    if (el.sizeMode.value === 'ratio') {
        const mp = parseFloat(el.megapixels.value) || 1.0;
        const { w, h } = getCurrentRatio();
        const total = mp * 1000000;
        return {
            width: clampSize(snapTo8(Math.sqrt(total * w / h))),
            height: clampSize(snapTo8(Math.sqrt(total * h / w))),
        };
    }
    return {
        width: clampSize(snapTo8(parseInt(el.width.value, 10) || 512)),
        height: clampSize(snapTo8(parseInt(el.height.value, 10) || 512)),
    };
}

// ---------- Style templates (styles.json) ----------
async function loadStyles() {
    const res = await api.getStyles();
    if (!res.ok || !Array.isArray(res.styles)) {
        styles = [];
        return;
    }
    styles = res.styles;
    renderStyleSelect();
}
function renderStyleSelect() {
    const current = el.styleSelect.value;
    el.styleSelect.innerHTML = '';
    el.styleSelect.appendChild(new Option('None', ''));
    for (const s of styles) {
        if (s.name.toLowerCase() === 'none') continue;
        el.styleSelect.appendChild(new Option(s.name, s.id));
    }
    if (styles.some((s) => String(s.id) === current)) {
        el.styleSelect.value = current;
    } else {
        el.styleSelect.value = settings.selectedStyle || '';
    }
    renderStyleList();
    updateStylePickerLabel();
}

function renderStyleList() {
    const list = el.styleList;
    if (!list) return;
    const current = el.styleSelect.value;
    const q = (el.stylePopoverSearch.value || '').trim().toLowerCase();
    list.innerHTML = '';

    const rows = [];
    const noneRow = document.createElement('button');
    noneRow.type = 'button';
    noneRow.className = 'style-row' + (current === '' ? ' active' : '');
    noneRow.innerHTML = '<span class="style-row-name">None</span><span class="style-row-preview">No style template</span>';
    noneRow.addEventListener('click', () => selectStyle(''));
    rows.push(noneRow);

    const filtered = styles.filter((s) => {
        if (s.name.toLowerCase() === 'none') return false;
        if (!q) return true;
        return s.name.toLowerCase().includes(q) || (s.prompt || '').toLowerCase().includes(q);
    });
    for (const s of filtered) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'style-row' + (String(s.id) === current ? ' active' : '');
        const preview = (s.prompt || '').trim().replace(/\{prompt\}/g, '…').slice(0, 80);
        row.innerHTML = `<span class="style-row-name">${esc(s.name)}</span><span class="style-row-preview">${esc(preview)}</span>`;
        row.addEventListener('click', () => selectStyle(String(s.id)));
        rows.push(row);
    }
    if (filtered.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No styles match.';
        rows.push(empty);
    }
    for (const r of rows) list.appendChild(r);
}

function selectStyle(id) {
    el.styleSelect.value = id;
    handleStyleChange();
    closeStylePopover();
    renderStyleList();
    updateStylePickerLabel();
}

function updateStylePickerLabel() {
    const current = el.styleSelect.value;
    const style = getSelectedStyle();
    el.stylePickerLabel.textContent = style ? style.name : 'None';
}

function openStylePopover() {
    el.stylePopover.hidden = false;
    el.stylePickerBtn.classList.add('open');
    renderStyleList();
    if (el.stylePopoverSearch) {
        el.stylePopoverSearch.value = '';
        el.stylePopoverSearch.focus();
    }
}

function closeStylePopover() {
    el.stylePopover.hidden = true;
    el.stylePickerBtn.classList.remove('open');
}

function getSelectedStyle() {
    const id = el.styleSelect.value;
    return styles.find((s) => String(s.id) === id) || null;
}

// ---------- Themes (user-editable CSS) ----------
async function loadThemes() {
    const res = await api.listThemes();
    if (!res.ok || !Array.isArray(res.themes)) return;
    themesAvailable = res.themes;
    const current = settings.theme || 'neutral';
    el.themeSelect.innerHTML = '';
    for (const t of themesAvailable) {
        const opt = new Option(t.name, t.name);
        el.themeSelect.appendChild(opt);
    }
    if (themesAvailable.some((t) => t.name === current)) {
        el.themeSelect.value = current;
    }
}

async function applyTheme(name) {
    const res = await api.getTheme(name);
    if (!res.ok) return;
    let style = document.getElementById('themeStyle');
    if (!style) {
        style = document.createElement('style');
        style.id = 'themeStyle';
        document.head.appendChild(style);
    }
    style.textContent = res.css || '';
}

// ---------- Generation progress ----------
function showProgress(indeterminate, text, pct) {
    el.genProgressCard.hidden = false;
    el.genProgressFill.classList.toggle('indeterminate', !!indeterminate);
    if (pct != null) {
        el.genProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        el.genProgressFill.style.marginLeft = '0';
    } else {
        el.genProgressFill.style.width = '';
        el.genProgressFill.style.marginLeft = '';
    }
    el.genProgressText.textContent = text || '';
}

function hideProgress() {
    el.genProgressCard.hidden = true;
    el.genProgressFill.style.width = '';
    el.genProgressFill.style.marginLeft = '';
    el.genProgressText.textContent = '';
}

// Parse "x%" or "x/y" progress from server log lines to update the bar.
function progressFromLog(message) {
    const m = String(message || '').match(/(\d{1,3}(?:\.\d+)?)%/);
    if (m) return Math.min(100, parseFloat(m[1]));
    const ratio = String(message || '').match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
    if (ratio) {
        const num = parseInt(ratio[1], 10);
        const den = parseInt(ratio[2], 10);
        if (den > 0) return Math.min(100, (num / den) * 100);
    }
    return null;
}

// Combine the user's prompt with the style template at generation time.
// A style's prompt can contain a {prompt} placeholder; without one it is
// simply prepended to the user's prompt. The style's negative_prompt is
// appended to the user's negative prompt.
function getEffectivePrompt() {
    const userPrompt = el.prompt.value.trim();
    const userNeg = el.negativePrompt.value.trim();
    const style = getSelectedStyle();
    if (!style) {
        return { prompt: userPrompt, negative: userNeg };
    }
    const template = (style.prompt || '').trim();
    let prompt;
    if (template.includes('{prompt}')) {
        prompt = template.replace(/\{prompt\}/g, userPrompt).trim();
    } else {
        prompt = [template, userPrompt].filter(Boolean).join(' ').trim();
    }
    const negative = [userNeg, (style.negative_prompt || '').trim()].filter(Boolean).join(', ');
    return { prompt, negative };
}

function handleStyleChange() {
    settings.selectedStyle = el.styleSelect.value;
    saveSettingsFromUi();
    const style = getSelectedStyle();
    setGenStatus(style ? `Style: ${style.name}` : '', 'done');
}

// ---------- Gallery ----------
async function ensureGalleryDir() {
    if (galleryDir) return galleryDir;
    try {
        const dir = await api.pickDirectory({ title: 'Choose a folder for generated images (optional). If you cancel, images stay in-app only.' });
        galleryDir = dir;
        return dir;
    } catch {
        return null;
    }
}

async function addToGallery(imageB64, meta) {
    const id = Date.now() + Math.random().toString(36).slice(2, 7);
    const item = { id, imageB64, meta, savedPath: null };
    galleryItems.push(item);
    renderGallery();
}

function base64ToUint8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function renderGallery() {
    const countEl = document.getElementById('galleryCount');
    if (countEl) countEl.textContent = galleryItems.length ? `(${galleryItems.length})` : '';
    if (!galleryItems.length) {
        el.gallery.innerHTML = '<p class="muted">Generated images will appear here.</p>';
        return;
    }
    el.gallery.innerHTML = '';
    for (const item of galleryItems.slice().reverse()) {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${item.imageB64}`;
        img.alt = 'generated';
        const overlay = document.createElement('div');
        overlay.className = 'gallery-overlay';
        const btnView = document.createElement('button');
        btnView.className = 'btn btn-sm';
        btnView.textContent = 'View';
        btnView.addEventListener('click', () => openPreview(item));
        overlay.appendChild(btnView);
        div.appendChild(img);
        div.appendChild(overlay);
        const btnSave = document.createElement('button');
        btnSave.className = 'save-badge';
        btnSave.textContent = item.savedPath ? 'Saved' : 'Save';
        btnSave.disabled = !!item.savedPath;
        btnSave.addEventListener('click', async () => {
            if (item.savedPath) return;
            const fp = await api.saveImage({ defaultName: 'generated.png' });
            if (fp) {
                const buf = base64ToUint8(item.imageB64);
                await api.writeFile(fp, buf);
                item.savedPath = fp;
                renderGallery();
            }
        });
        div.appendChild(btnSave);
        el.gallery.appendChild(div);
    }
}

function openPreview(item) {
    const existing = document.querySelector('.preview-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay open';
    const box = document.createElement('div');
    box.className = 'preview-box';
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${item.imageB64}`;
    const actions = document.createElement('div');
    actions.className = 'preview-actions';
    const btnClose = document.createElement('button');
    btnClose.className = 'btn';
    btnClose.textContent = 'Close';
    const btnSave = document.createElement('button');
    btnSave.className = 'btn btn-primary';
    btnSave.textContent = 'Save...';
    btnSave.addEventListener('click', async () => {
        const fp = await api.saveImage({ defaultName: 'generated.png' });
        if (fp) {
            await api.writeFile(fp, base64ToUint8(item.imageB64));
            btnSave.textContent = 'Saved';
        }
    });
    actions.appendChild(btnClose);
    actions.appendChild(btnSave);
    box.appendChild(img);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    btnClose.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
}

// ---------- LoRA slots ----------
function getLoraOptions() {
    return (modelsState && modelsState.loras) || [];
}

function renderLoraSlots() {
    el.loraSlots.innerHTML = '';
    if (!loraSlots.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No LoRAs selected. Use "+ Add LoRA" to stack multiple.';
        el.loraSlots.appendChild(p);
        return;
    }
    const options = getLoraOptions();
    loraSlots.forEach((slot, i) => {
        const row = document.createElement('div');
        row.className = 'lora-slot';

        const top = document.createElement('div');
        top.className = 'lora-slot-top';

        const select = document.createElement('select');
        const placeholder = new Option(options.length ? '— select a LoRA —' : 'No LoRAs detected in loras/ folder', '');
        placeholder.disabled = true;
        select.appendChild(placeholder);
        for (const l of options) {
            select.appendChild(new Option(l.name, l.path));
        }
        select.value = slot.path && Array.from(select.options).some((o) => o.value === slot.path) ? slot.path : '';
        select.addEventListener('change', () => {
            slot.path = select.value;
            slot.name = slot.path ? (options.find((o) => o.path === slot.path) || {}).name || slot.path : '';
            saveLoraSlots();
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'lora-slot-remove';
        remove.textContent = '\u2715';
        remove.title = 'Remove this LoRA';
        remove.addEventListener('click', () => {
            loraSlots.splice(i, 1);
            saveLoraSlots();
            renderLoraSlots();
        });

        top.appendChild(select);
        top.appendChild(remove);

        const strength = document.createElement('div');
        strength.className = 'lora-slot-strength';
        const sLabel = document.createElement('span');
        sLabel.textContent = 'Strength';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 2;
        slider.step = 0.05;
        slider.value = (typeof slot.multiplier === 'number' ? slot.multiplier : 0.8);
        const sVal = document.createElement('span');
        sVal.className = 'lora-strength-val';
        const setVal = () => {
            sVal.textContent = parseFloat(slider.value).toFixed(2);
            slot.multiplier = parseFloat(slider.value);
        };
        slider.addEventListener('input', () => {
            setVal();
            saveLoraSlots();
        });
        setVal();
        strength.appendChild(sLabel);
        strength.appendChild(slider);
        strength.appendChild(sVal);

        const highNoise = document.createElement('label');
        highNoise.className = 'lora-high-noise';
        highNoise.title = 'Needed for Flux/Qwen high-noise LoRAs';
        const hnCheck = document.createElement('input');
        hnCheck.type = 'checkbox';
        hnCheck.checked = !!slot.is_high_noise;
        hnCheck.addEventListener('change', () => {
            slot.is_high_noise = hnCheck.checked;
            saveLoraSlots();
        });
        const hnLabel = document.createElement('span');
        hnLabel.textContent = 'High-noise';
        highNoise.appendChild(hnCheck);
        highNoise.appendChild(hnLabel);

        row.appendChild(top);
        row.appendChild(strength);
        row.appendChild(highNoise);
        el.loraSlots.appendChild(row);
    });
}

function addLoraSlot() {
    loraSlots.push({ name: '', path: '', multiplier: 0.8, is_high_noise: false });
    saveLoraSlots();
    renderLoraSlots();
}

function saveLoraSlots() {
    const cleaned = loraSlots.map((s) => ({
        name: s.name || '',
        path: s.path || '',
        multiplier: Math.min(2, Math.max(0, parseFloat(s.multiplier) || 0)),
        is_high_noise: !!s.is_high_noise,
    }));
    api.setSettings({ loraSlots: cleaned });
}

function getActiveLoraSlots() {
    return loraSlots.filter((s) => s.path);
}

// ---------- Image editing (reference-image / DiT edit models) ----------
function setEditMode(on) {
    editMode = !!on;
    el.modeGenerate.classList.toggle('active', !editMode);
    el.modeEdit.classList.toggle('active', editMode);
    el.editPanel.hidden = !editMode;
    el.prompt.placeholder = editMode
        ? 'Describe the edit to apply to the loaded image, e.g. "make it rainy and moody"'
        : 'Describe the image you want to generate...';
}

function setInitImageData(name, dataUrl, width, height) {
    initImage = { name, dataUrl, width, height };
    renderEditPreview();
}

function clearImage() {
    initImage = null;
    renderEditPreview();
}

function renderEditPreview() {
    el.editPreview.innerHTML = '';
    el.btnClearImage.disabled = !initImage;
    if (!initImage) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No image loaded. Load one, then describe the edit in the prompt below.';
        el.editPreview.appendChild(p);
        return;
    }
    const img = document.createElement('img');
    img.src = initImage.dataUrl;
    img.alt = initImage.name;
    img.title = `${initImage.name} (${initImage.width}\u00d7${initImage.height})`;
    el.editPreview.appendChild(img);
}

async function loadImage() {
    const res = await api.pickImage();
    if (!res.ok) {
        if (res && res.error) setGenStatus(`Could not load image: ${res.error}`, 'error');
        return;
    }
    const img = new Image();
    img.onload = () => setInitImageData(res.name, res.dataUrl, img.naturalWidth, img.naturalHeight);
    img.onerror = () => setGenStatus('Could not read that image file.', 'error');
    img.src = res.dataUrl;
}

// ---------- Generation ----------
function loraNameForServer(fullPath) {
    const base = String(fullPath || '').split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
}

function buildNativePayload() {
    const eff = getEffectivePrompt();
    if (!eff.prompt) {
        setGenStatus('Enter a prompt first.', 'error');
        return null;
    }
    const lora = getActiveLoraSlots()
        .map((l) => ({
            path: loraNameForServer(l.path),
            multiplier: l.multiplier,
            is_high_noise: !!l.is_high_noise,
        }))
        .filter((e) => e.path);
    const size = computeEffectiveSize();
    const payload = {
        prompt: eff.prompt,
        negative_prompt: eff.negative,
        width: size.width,
        height: size.height,
        seed: parseInt(el.seed.value, 10) || -1,
        batch_count: parseInt(el.batchCount.value, 10) || 1,
        sample_params: {
            scheduler: el.scheduler.value,
            sample_method: el.sampler.value,
            sample_steps: parseInt(el.steps.value, 10) || 20,
            guidance: {
                txt_cfg: parseFloat(el.cfgScale.value) || 7.0,
            },
        },
        lora,
        output_format: el.outputFormat.value,
        output_compression: 100,
    };
    if (editMode && initImage) {
        payload.ref_images = [initImage.dataUrl];
        payload.auto_resize_ref_image = true;
        payload.increase_ref_index = false;
        payload.strength = parseFloat(el.editStrength.value) || 0.75;
        payload.width = clampSize(snapTo8(initImage.width));
        payload.height = clampSize(snapTo8(initImage.height));
    }
    return payload;
}

function buildSdapiPayload() {
    const eff = getEffectivePrompt();
    if (!eff.prompt) return null;
    const lora = getActiveLoraSlots().map((l) => ({
        name: l.name,
        path: l.path,
        multiplier: l.multiplier,
    }));
    const size = computeEffectiveSize();
    return {
        prompt: eff.prompt,
        negative_prompt: eff.negative,
        width: size.width,
        height: size.height,
        steps: parseInt(el.steps.value, 10) || 20,
        cfg_scale: parseFloat(el.cfgScale.value) || 7.0,
        seed: parseInt(el.seed.value, 10) || -1,
        batch_size: parseInt(el.batchCount.value, 10) || 1,
        sampler_name: el.sampler.value,
        scheduler: el.scheduler.value,
        lora,
    };
}

async function generate() {
    if (backendState.status !== 'running') {
        setGenStatus('Server is not running. Start it first.', 'error');
        return;
    }
    if (editMode && !initImage) {
        setGenStatus('Load an image to edit first.', 'error');
        return;
    }
    const payload = buildNativePayload();
    if (!payload) return;
    payloadForLastJob = payload;

    // Pre-validate LoRAs: ensure each is found in lora dir (OS-agnostic name check)
    if (payload.lora && payload.lora.length) {
        const knownNames = new Set((modelsState && modelsState.loras || []).map((f) => loraNameForServer(f.path).toLowerCase()));
        const missing = payload.lora.filter((l) => !knownNames.has(String(l.path || '').toLowerCase()));
        if (missing.length) {
            const names = missing.map((m) => m.path).join(', ');
            setGenStatus(`LoRA not found in --lora-model-dir (${el.loraDirInput.value || 'not set'}): ${names}. Check Settings → Models → LoRA folder and Server Log.`, 'error');
            // still try submitting — server will give authoritative error
        }
        console.log('[SD Studio] Submitting with LoRAs:', payload.lora);
    } else {
        console.log('[SD Studio] Submitting payload (no LoRA):', { ...payload, lora: [] });
    }
    console.log('[SD Studio] Full payload:', JSON.stringify(payload).slice(0, 4000));

    const genStart = Date.now();
    setBusy(true);
    setGenStatus('Submitting job...', 'busy');

    try {
        const res = await api.submitJob(payload);
        if (!res.ok) {
            const serverHint = (backendState.logs || []).slice(-40).filter((l) => /lora|invalid|can not find|must be a model name/i.test(l.message)).map((l) => l.message.trim()).join('\n');
            const hint = serverHint ? `\nServer log:\n${serverHint}` : '\nTip: Check Server Log card for details (search "lora"). LoRA path must be just the name without folder/extension and file must exist in the LoRA folder.';
            setGenStatus(`Submission failed: ${res.error}${hint}`, 'error');
            console.error('[SD Studio] Submission failed payload:', payload, 'logs:', serverHint);
            hideProgress();
            setBusy(false);
            return;
        }
        activeJob = res.job;
        activeJob._genStart = genStart;
        showProgress(true, `Job ${res.job.id} queued...`);
        setGenStatus(`Job ${res.job.id} queued...`, 'busy');
        pollTimer = setInterval(pollJob, 1200);
    } catch (err) {
        const serverHint = (backendState.logs || []).slice(-40).filter((l) => /lora|invalid|can not find|must be a model name/i.test(l.message)).map((l) => l.message.trim()).join('\n');
        const msg = err.message || String(err);
        const hint = serverHint ? `\nServer log:\n${serverHint}` : '';
        setGenStatus(`Error: ${msg}${hint}`, 'error');
        console.error('[SD Studio] Submit exception:', err, 'payload:', payload);
        hideProgress();
        setBusy(false);
    }
}

async function pollJob() {
    if (!activeJob) return;
    try {
        const res = await api.getJob(activeJob.id);
        if (!res.ok) {
            stopPolling();
            setGenStatus(`Job error: ${res.error}`, 'error');
            setBusy(false);
            return;
        }
        const job = res.job;
        if (job.status === 'completed') {
            stopPolling();
            showProgress(false, 'Done.', 100);
            handleCompletion(job);
            setTimeout(hideProgress, 1500);
        } else if (job.status === 'failed') {
            stopPolling();
            hideProgress();
            const msg = job.error && (job.error.message || job.error.code) ? (job.error.message || job.error.code) : 'Generation failed';
            setGenStatus(msg, 'error');
            setBusy(false);
        } else if (job.status === 'cancelled') {
            stopPolling();
            hideProgress();
            setGenStatus('Cancelled.', '');
            setBusy(false);
        } else if (job.status === 'generating') {
            showProgress(true, 'Generating...');
            setGenStatus('Generating...', 'busy');
        } else {
            const qp = job.queue_position != null ? ` · queue ${job.queue_position}` : '';
            showProgress(true, `Queued${qp}`);
            setGenStatus(`${job.status}${qp}`, 'busy');
        }
    } catch (err) {
        stopPolling();
        setGenStatus(`Poll error: ${err.message}`, 'error');
        setBusy(false);
    }
}

function handleCompletion(job) {
    const start = activeJob && activeJob._genStart ? activeJob._genStart : null;
    const elapsed = start ? ((Date.now() - start) / 1000).toFixed(1) : null;
    setBusy(false);
    if (elapsed) {
        setGenStatus(`Done! in ${elapsed}s`, 'done');
        console.log(`[SD Studio] Generation completed in ${elapsed}s`, job);
        // Hint if unusually slow with LoRA and auto mode
        const loraCount = payloadForLastJob && payloadForLastJob.lora ? payloadForLastJob.lora.length : 0;
        if (parseFloat(elapsed) > 60 && loraCount > 0) {
            const mode = settings.loraApplyMode || 'auto';
            if (mode === 'auto' || mode === 'at_runtime') {
                console.log('[SD Studio] Slow LoRA generation — try Settings → Models → LoRA apply mode: immediately (requires restart)');
            }
        } else if (parseFloat(elapsed) > 90 && loraCount === 0) {
            console.log('[SD Studio] Slow generation — check Settings → Runtime & GPU → Check to confirm GPU is detected and backend is CUDA. Also try lowering steps or enabling --diffusion-fa in Settings → Server → Extra args.');
        }
    } else {
        setGenStatus('Done!', 'done');
    }
    const result = job.result || {};
    const images = result.images || [];
    if (result.b64_json) {
        addToGallery(result.b64_json, job);
    }
    for (const img of images) {
        if (img.b64_json) addToGallery(img.b64_json, job);
    }
    if (!images.length && !result.b64_json) {
        setGenStatus('Job completed but returned no image.', 'error');
    }
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    activeJob = null;
}

async function cancelGeneration() {
    if (!activeJob) {
        stopPolling();
        setBusy(false);
        return;
    }
    const id = activeJob.id;
    try {
        await api.cancelJob(id);
        setGenStatus('Cancelling...', 'busy');
    } catch (err) {
        setGenStatus(`Cancel error: ${err.message}`, 'error');
    }
}

// ---------- Models (folder-based detection) ----------
async function refreshModels() {
    const res = await api.getModels();
    if (!res.ok) {
        modelsState = null;
        return;
    }
    modelsState = res;
    // Auto-point LoRA dir at the detected loras/ subfolder when unset
    const loraSub = modelsState.subDirs && modelsState.subDirs.loras;
    if (loraSub && !settings.loraDir) {
        await api.setSettings({ loraDir: loraSub });
        settings = await api.getSettings();
    }
    renderModels();
}

function setStructDot(sub, exists) {
    const dot = document.querySelector(`.struct-dot[data-sub="${sub}"]`);
    if (dot) dot.className = `struct-dot ${exists ? 'ok' : 'missing'}`;
}

function renderModels() {
    if (!modelsState) return;
    el.modelDirInput.value = modelsState.dir || '';
    setStructDot('models', modelsState.models.length > 0 || (modelsState.subDirs.models && modelsState.exists));
    setStructDot('loras', (modelsState.subDirs.loras && modelsState.loras.length > 0));
    setStructDot('vae', (modelsState.subDirs.vae && modelsState.vae.length > 0));
    setStructDot('textEncoders', (modelsState.subDirs.textEncoders && modelsState.textEncoders.length > 0));
    el.btnModelDirCreate.disabled = !modelsState.dir;
    el.btnModelDirOpen.disabled = !modelsState.dir;

    const currentModel = settings.diffusionModelPath || settings.modelPath || '';
    fillModelSelect(el.selModel, modelsState.models, currentModel, 'None');
    fillModelSelect(el.selVae, modelsState.vae, settings.vaePath || '', 'None');
    fillModelSelect(el.selTextEncoder, modelsState.textEncoders, settings.textEncoderPath || '', 'None');
    fillModelSelect(el.selVisionEncoder, modelsState.visionEncoders, settings.visionEncoderPath || '', 'None');

    el.loraDirInput.value = settings.loraDir || (modelsState.subDirs && modelsState.subDirs.loras) || '';
    const loraCount = modelsState.loras ? modelsState.loras.length : 0;
    el.loraDirInput.placeholder = loraCount ? `${loraCount} LoRA(s) detected` : 'No LoRAs in loras/ subfolder yet';
    renderLoraSlots();
    // keep manager in sync if open
    if (el.modelManagerModal && !el.modelManagerModal.hidden) renderModelManager();
}

function openModelManager() {
    if (!modelsState) refreshModels().then(() => { renderModelManager(); el.modelManagerModal.hidden = false; });
    else { renderModelManager(); el.modelManagerModal.hidden = false; }
}
function closeModelManager() { if (el.modelManagerModal) el.modelManagerModal.hidden = true; }

function renderModelManager() {
    if (!modelsState) return;
    const tabs = {
        'mgr-models': { key: 'models', type: 'diffusion', label: 'Diffusion models', empty: 'No diffusion models yet. Use Add to link a file.' },
        'mgr-loras': { key: 'loras', type: 'lora', label: 'LoRAs', empty: 'No LoRAs yet.' },
        'mgr-vae': { key: 'vae', type: 'vae', label: 'VAE', empty: 'No VAE files.' },
        'mgr-textEncoders': { key: 'textEncoders', type: 'textEncoder', label: 'Text encoders', empty: 'No text encoders.' },
        'mgr-visionEncoders': { key: 'visionEncoders', type: 'visionEncoder', label: 'Vision encoders', empty: 'No vision encoders.' },
    };
    for (const [panelId, cfg] of Object.entries(tabs)) {
        const panel = document.getElementById(panelId);
        if (!panel) continue;
        const files = modelsState[cfg.key] || [];
        panel.innerHTML = '';
        const toolbar = document.createElement('div');
        toolbar.className = 'manager-toolbar';
        const count = document.createElement('span');
        count.className = 'manager-count';
        count.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-sm btn-primary';
        addBtn.textContent = `＋ Add ${cfg.label}`;
        addBtn.addEventListener('click', async () => {
            const res = await api.linkModelFile({ type: cfg.type });
            if (!res || res.canceled) return;
            if (!res.ok) { setGenStatus(`Add failed: ${res.error}`, 'error'); return; }
            modelsState = res.scan;
            renderModels();
            renderModelManager();
            setGenStatus(`Added ${res.name}`, 'done');
        });
        toolbar.appendChild(count);
        toolbar.appendChild(addBtn);
        panel.appendChild(toolbar);
        if (!files.length) {
            const empty = document.createElement('div');
            empty.className = 'manager-empty';
            empty.textContent = cfg.empty;
            panel.appendChild(empty);
            continue;
        }
        const list = document.createElement('div');
        list.className = 'manager-file-list';
        for (const f of files) {
            const row = document.createElement('div');
            row.className = 'manager-file-item';
            const info = document.createElement('div');
            info.className = 'manager-file-info';
            const name = document.createElement('div');
            name.className = 'manager-file-name';
            name.textContent = f.name + (f.empty ? '  ⚠ empty' : '');
            name.title = f.path;
            const meta = document.createElement('div');
            meta.className = 'manager-file-meta';
            meta.textContent = `${fmtBytes(f.size)}  •  ${f.path}`;
            meta.title = f.path;
            info.appendChild(name);
            info.appendChild(meta);
            const actions = document.createElement('div');
            actions.className = 'manager-file-actions';
            const revealBtn = document.createElement('button');
            revealBtn.className = 'btn btn-sm btn-ghost';
            revealBtn.textContent = 'Show';
            revealBtn.title = 'Show in file manager';
            revealBtn.addEventListener('click', () => api.openPath(f.path));
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-sm btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                if (!confirm(`Move "${f.name}" to Recycle Bin?\n\n${f.path}`)) return;
                delBtn.disabled = true;
                const res = await api.deleteModelFile(f.path);
                if (!res.ok) { setGenStatus(`Delete failed: ${res.error}`, 'error'); delBtn.disabled = false; return; }
                modelsState = res.scan;
                renderModels();
                renderModelManager();
                setGenStatus(`Deleted ${f.name}`, 'done');
            });
            actions.appendChild(revealBtn);
            actions.appendChild(delBtn);
            row.appendChild(info);
            row.appendChild(actions);
            list.appendChild(row);
        }
        panel.appendChild(list);
    }
}

function fillModelSelect(select, files, currentPath, noneLabel) {
    const prev = select.value;
    select.innerHTML = '';
    select.appendChild(new Option(noneLabel || 'None', ''));
    for (const f of files || []) {
        const label = f.empty ? `${f.name}  ⚠ empty (0 bytes)` : f.name;
        const opt = new Option(label, f.path);
        opt.title = f.path + (f.empty ? ' — 0 bytes, download may be incomplete' : '');
        select.appendChild(opt);
    }
    if (currentPath && Array.from(select.options).some((o) => o.value === currentPath)) {
        select.value = currentPath;
    } else {
        select.value = '';
    }
}

async function onModelSelect() {
    const val = el.selModel.value;
    const picked = (modelsState.models || []).find((m) => m.path === val);
    // .safetensors/.ckpt/.pth/.pt load via the unified -m flag; .gguf/.bin via
    // --diffusion-model. Pick the matching setting so buildLaunchArgs uses the right flag.
    const patch = picked && picked.mode === 'unified'
        ? { modelPath: val || '', diffusionModelPath: '' }
        : { modelPath: '', diffusionModelPath: val || '' };
    await api.setSettings(patch);
    settings = await api.getSettings();
    renderModels();
    setGenStatus(val ? `Model set. Restart the server to apply.` : 'Model cleared.', 'done');
}

async function onVaeSelect() {
    await api.setSettings({ vaePath: el.selVae.value || '' });
    settings = await api.getSettings();
    renderModels();
}

async function onTextEncoderSelect() {
    await api.setSettings({ textEncoderPath: el.selTextEncoder.value || '' });
    settings = await api.getSettings();
    renderModels();
}

async function onVisionEncoderSelect() {
    await api.setSettings({ visionEncoderPath: el.selVisionEncoder.value || '' });
    settings = await api.getSettings();
    renderModels();
}

async function chooseModelDir() {
    const res = await api.chooseModelsDir();
    if (!res.ok || res.canceled) return;
    const scan = await api.setModelsDir(res.dir);
    if (scan.ok) {
        modelsState = scan;
        await api.setSettings({});
        settings = await api.getSettings();
        renderModels();
    }
}

async function createModelStructure() {
    let dir = el.modelDirInput.value || modelsState.suggestedDir;
    if (!dir) dir = modelsState.suggestedDir;
    const res = await api.createModelsStructure(dir);
    if (!res.ok) {
        setGenStatus(`Could not create structure: ${res.error}`, 'error');
        return;
    }
    modelsState = res;
    await api.setSettings({});
    settings = await api.getSettings();
    renderModels();
    setGenStatus('Model folder structure created.', 'done');
}

async function linkModelFile() {
    const type = el.linkModelType.value;
    setGenStatus('Picking file...', 'busy');
    const res = await api.linkModelFile({ type });
    if (!res.ok) {
        setGenStatus(`Link failed: ${res.error}`, 'error');
        setBusy(false);
        return;
    }
    if (res.canceled) {
        setGenStatus('', '');
        setBusy(false);
        return;
    }
    modelsState = res.scan;
    settings = await api.getSettings();
    renderModels();
    const linkPath = res.linkPath || '';
    const patch = {};
    if (type === 'diffusion') {
        const linked = (res.scan.models || []).find((m) => m.path === linkPath);
        if (linked && linked.mode === 'unified') {
            patch.modelPath = linkPath; patch.diffusionModelPath = '';
        } else {
            patch.modelPath = ''; patch.diffusionModelPath = linkPath;
        }
    }
    else if (type === 'vae') patch.vaePath = linkPath;
    else if (type === 'textEncoder') patch.textEncoderPath = linkPath;
    else if (type === 'visionEncoder') patch.visionEncoderPath = linkPath;
    else if (type === 'lora' && res.linkPath && !loraSlots.some((s) => s.path === res.linkPath)) {
        loraSlots.push({ path: res.linkPath, name: res.name || '', multiplier: 0.8, is_high_noise: false });
        saveLoraSlots();
    }
    if (Object.keys(patch).length) {
        settings = await api.setSettings(patch);
    }
    renderModels();
    setGenStatus(`Linked ${res.name || 'file'}`, 'done');
}

// ---------- App data folder ----------
async function loadDataInfo() {
    const info = await api.getDataInfo();
    if (!info) return;
    el.dataDirInput.value = info.current || '';
    el.dataDirInput.title = info.current || '';
    el.btnDataDirReset.disabled = !info.custom;
}

async function changeDataDir() {
    const dir = await api.pickDirectory({ title: 'Choose the self-contained app data folder' });
    if (!dir) return;
    el.dataMigrateWrap.hidden = false;
    el.dataMigrateFill.style.width = '0%';
    el.dataMigrateText.textContent = 'Preparing...';
    const res = await api.setDataDir(dir);
    if (!res.ok) {
        el.dataMigrateWrap.hidden = true;
        setGenStatus(`Data folder change failed: ${res.error}`, 'error');
        return;
    }
    if (res.restarting) {
        el.dataMigrateText.textContent = 'Done. Restarting the app...';
        setGenStatus('App data folder changed. Restarting...', 'busy');
    }
}

async function resetDataDir() {
    if (!window.confirm('Reset the app data folder to the default location? The app will restart.')) return;
    const res = await api.resetDataDir();
    if (res.ok && res.restarting) {
        setGenStatus('Reverting to default app data location. Restarting...', 'busy');
    }
}

// ---------- Backend operations ----------
async function startServer() {
    await saveSettingsFromUi();
    const modelPath = settings.modelPath || settings.diffusionModelPath;
    if (!modelPath) {
        setGenStatus('No model selected. Pick a diffusion model in Settings → Models.', 'error');
        el.settingsModal.hidden = false;
        setBusy(false);
        return;
    }
    const emptyFiles = await api.checkModelFiles([settings.modelPath, settings.diffusionModelPath].filter(Boolean));
    const empty = (emptyFiles || []).find((f) => f.empty);
    if (empty) {
        setGenStatus(
            `The model file "${empty.name}" is empty (0 bytes) — the download is incomplete or corrupt. Delete it from the Models folder and re-download it.`,
            'error'
        );
        el.settingsModal.hidden = false;
        setBusy(false);
        return;
    }
    setGenStatus('Starting server...', 'busy');
    const res = await api.startServer();
    if (res.ok) {
        if (res.alreadyRunning) {
            setGenStatus('Server already running.', 'done');
        } else {
            setGenStatus('Server starting...', 'busy');
        }
    } else {
        setGenStatus(`Start failed: ${res.error}`, 'error');
        setBusy(false);
    }
}

async function stopServer() {
    setGenStatus('Stopping server...', 'busy');
    await api.stopServer();
    setBusy(false);
    setGenStatus('', '');
}

async function importZip() {
    const res = await api.importZip();
    if (res.ok) {
        renderBackendState();
        setGenStatus('Backend imported.', 'done');
        el.serverBinary.value = res.serverPath;
        saveSettingsFromUi();
    } else if (!res.canceled) {
        setGenStatus(`Import failed: ${res.error}`, 'error');
    }
}

async function linkBackendFolder() {
    const res = await api.linkBackendDir();
    if (res.ok) {
        renderBackendState();
        setGenStatus('Backend linked.', 'done');
        el.serverBinary.value = res.serverPath;
        saveSettingsFromUi();
    } else if (!res.canceled) {
        setGenStatus(`Link failed: ${res.error}`, 'error');
    }
}

async function showLatestReleases() {
    el.downloadArea.hidden = false;
    el.assetList.innerHTML = '<p class="muted">Fetching latest release...</p>';
    const res = await api.getLatestRelease();
    if (!res.ok) {
        el.assetList.innerHTML = `<p class="muted">Failed: ${res.error}</p>`;
        return;
    }
    const rel = res.release;
    el.downloadLabel.textContent = `Latest: ${rel.tag} (${new Date(rel.publishedAt).toLocaleDateString()}) — pick an asset for your platform`;
    el.assetList.innerHTML = '';

    // Prefer assets for current platform
    const sorted = [...rel.assets].sort((a, b) => {
        const aCur = /win|darwin|macos|linux/.test(a.name.toLowerCase());
        const bCur = /win|darwin|macos|linux/.test(b.name.toLowerCase());
        return (bCur ? 1 : 0) - (aCur ? 1 : 0);
    });

    for (const asset of sorted.slice(0, 12)) {
        const item = document.createElement('div');
        item.className = 'asset-item';
        const name = document.createElement('span');
        name.className = 'asset-name';
        name.textContent = asset.name;
        name.title = asset.name;
        const size = document.createElement('span');
        size.className = 'asset-size';
        size.textContent = fmtBytes(asset.size);
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = 'Install';
        btn.addEventListener('click', () => downloadAsset(asset, rel.tag));
        item.appendChild(name);
        item.appendChild(size);
        item.appendChild(btn);
        el.assetList.appendChild(item);
    }
}

async function downloadAsset(asset, tag) {
    el.progressWrap.hidden = false;
    el.progressFill.style.width = '0%';
    el.progressText.textContent = 'Downloading...';
    const res = await api.downloadAsset(asset.url, asset.name, tag);
    el.progressWrap.hidden = true;
    if (res.ok) {
        setGenStatus('Backend downloaded & installed.', 'done');
        el.serverBinary.value = res.serverPath;
        await saveSettingsFromUi();
    } else {
        setGenStatus(`Download failed: ${res.error}`, 'error');
    }
}

// ---------- Settings persistence ----------
function collectSettingsFromUi() {
    return {
        serverBinary: el.serverBinary.value,
        listenHost: el.listenHost.value,
        listenPort: parseInt(el.listenPort.value, 10) || 1234,
        extraArgs: el.extraArgs.value,
        refImageArgs: el.refImageArgs.value,
        autoStartServer: el.autoStart.checked,
        sizeMode: el.sizeMode.value,
        ratioPreset: el.ratioPreset.value,
        ratioW: parseInt(el.ratioW.value, 10) || 1,
        ratioH: parseInt(el.ratioH.value, 10) || 1,
        megapixels: parseFloat(el.megapixels.value) || 1.0,
        width: parseInt(el.width.value, 10) || 512,
        height: parseInt(el.height.value, 10) || 512,
        selectedStyle: el.styleSelect.value,
        steps: parseInt(el.steps.value, 10) || 20,
        cfgScale: parseFloat(el.cfgScale.value) || 7,
        seed: el.seed.value === '' ? -1 : parseInt(el.seed.value, 10),
        batchCount: parseInt(el.batchCount.value, 10) || 1,
        sampler: el.sampler.value,
        scheduler: el.scheduler.value,
        outputFormat: el.outputFormat.value,
        loraApplyMode: el.loraApplyMode ? el.loraApplyMode.value : 'auto',
    };
}

async function saveSettingsFromUi() {
    const patch = collectSettingsFromUi();
    settings = await api.setSettings(patch);
    return settings;
}

function applySettingsToUi() {
    el.listenHost.value = settings.listenHost || '127.0.0.1';
    el.listenPort.value = settings.listenPort || 1234;
    el.extraArgs.value = settings.extraArgs || '';
    el.refImageArgs.value = settings.refImageArgs || '';
    el.autoStart.checked = !!settings.autoStartServer;
    el.sizeMode.value = settings.sizeMode || 'manual';
    el.ratioPreset.value = settings.ratioPreset || '1:1';
    el.ratioW.value = settings.ratioW || 1;
    el.ratioH.value = settings.ratioH || 1;
    el.megapixels.value = settings.megapixels || 1.0;
    el.width.value = settings.width || 512;
    el.height.value = settings.height || 512;
    el.styleSelect.value = settings.selectedStyle || '';
    updateStylePickerLabel();
    el.steps.value = settings.steps || 20;
    el.cfgScale.value = settings.cfgScale || 7;
    el.seed.value = settings.seed != null ? settings.seed : -1;
    el.batchCount.value = settings.batchCount || 1;
    el.sampler.value = settings.sampler || 'euler_a';
    el.scheduler.value = settings.scheduler || 'discrete';
    el.outputFormat.value = settings.outputFormat || 'png';
    if (el.loraApplyMode) el.loraApplyMode.value = settings.loraApplyMode || 'auto';
    if (Array.isArray(settings.loraSlots)) {
        loraSlots = settings.loraSlots.map((s) => ({
            name: s.name || '',
            path: s.path || '',
            multiplier: typeof s.multiplier === 'number' ? s.multiplier : 0.8,
            is_high_noise: !!s.is_high_noise,
        }));
        if (!loraSlots.length) loraSlots = [{ name: '', path: '', multiplier: 0.8, is_high_noise: false }];
    } else {
        loraSlots = [{ name: '', path: '', multiplier: 0.8, is_high_noise: false }];
    }
    applySizeMode();
}

// ---------- Event wiring ----------
function bindEvents() {
    el.btnStart.addEventListener('click', startServer);
    el.btnStop.addEventListener('click', stopServer);
    el.btnImportZip.addEventListener('click', importZip);
    el.btnDownloadLatest.addEventListener('click', showLatestReleases);
    el.btnLinkFolder.addEventListener('click', linkBackendFolder);
    el.btnAddLora.addEventListener('click', addLoraSlot);

    // App data folder
    el.btnDataDirChange.addEventListener('click', changeDataDir);
    el.btnDataDirReset.addEventListener('click', resetDataDir);
    el.btnDataDirOpen.addEventListener('click', async () => {
        const info = await api.getDataInfo();
        if (info && info.current) await api.openPath(info.current);
    });

    // Mode toggle + image editing
    el.modeGenerate.addEventListener('click', () => setEditMode(false));
    el.modeEdit.addEventListener('click', () => setEditMode(true));
    el.btnLoadImage.addEventListener('click', loadImage);
    el.btnClearImage.addEventListener('click', clearImage);
    el.editStrength.addEventListener('input', () => {
        el.editStrengthVal.textContent = parseFloat(el.editStrength.value).toFixed(2);
    });

    // Collapsible cards
    document.querySelectorAll('.card-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.card');
            const body = document.getElementById(btn.dataset.target);
            const collapsed = card.classList.toggle('collapsed');
            if (body) body.hidden = collapsed;
            const arrow = btn.querySelector('.toggle-arrow');
            if (arrow) arrow.textContent = collapsed ? '\u25B8' : '\u25BE';
        });
    });

    // Collapsible panels — every panel can collapse to a slim rail
    function updatePanelLayout() {
        const l = document.getElementById('leftPanel')?.classList.contains('is-collapsed');
        const c = document.getElementById('centerPanel')?.classList.contains('is-collapsed');
        const r = document.getElementById('rightPanel')?.classList.contains('is-collapsed');
        const appBody = document.getElementById('appBody');
        if (!appBody) return;
        const lw = l ? '48px' : '320px';
        const cw = c ? '48px' : '1fr';
        const rw = r ? '48px' : '320px';
        appBody.style.gridTemplateColumns = `${lw} ${cw} ${rw}`;
        appBody.classList.toggle('has-collapsed', !!(l || c || r));
    }
    document.querySelectorAll('.panel-collapse-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panelId = btn.dataset.panel === 'left' ? 'leftPanel' : btn.dataset.panel === 'right' ? 'rightPanel' : 'centerPanel';
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const collapsed = panel.classList.toggle('is-collapsed');
            // flip chevron
            if (btn.dataset.panel === 'left') btn.textContent = collapsed ? '›' : '‹';
            else if (btn.dataset.panel === 'right') btn.textContent = collapsed ? '‹' : '›';
            else if (btn.dataset.panel === 'center') btn.textContent = collapsed ? '⧉' : '—';
            btn.title = collapsed ? 'Expand panel' : 'Collapse panel';
            updatePanelLayout();
        });
    });
    // clicking the collapsed rail itself also expands
    ['leftPanel', 'centerPanel', 'rightPanel'].forEach((id) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        panel.addEventListener('click', (e) => {
            if (!panel.classList.contains('is-collapsed')) return;
            // ignore clicks that bubbled from the button (already handled)
            if (e.target.closest('.panel-collapse-btn')) return;
            const btn = panel.querySelector('.panel-collapse-btn');
            if (!btn) return;
            panel.classList.remove('is-collapsed');
            if (btn.dataset.panel === 'left') btn.textContent = '‹';
            else if (btn.dataset.panel === 'right') btn.textContent = '›';
            else btn.textContent = '—';
            btn.title = 'Collapse panel';
            updatePanelLayout();
        });
    });

    // Settings modal
    el.btnSettings.addEventListener('click', () => { el.settingsModal.hidden = false; });
    el.btnSettingsClose.addEventListener('click', () => { el.settingsModal.hidden = true; });
    document.querySelectorAll('#settingsModal .settings-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#settingsModal .settings-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('#settingsModal .settings-tab-panel').forEach((p) => { p.hidden = true; });
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.tab);
            if (panel) panel.hidden = false;
        });
    });
    // Model Manager modal
    if (el.btnOpenModelManager) el.btnOpenModelManager.addEventListener('click', openModelManager);
    if (el.btnManagerClose) el.btnManagerClose.addEventListener('click', closeModelManager);
    if (el.modelManagerModal) el.modelManagerModal.addEventListener('click', (e) => { if (e.target === el.modelManagerModal) closeModelManager(); });
    document.querySelectorAll('#managerTabs .settings-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#managerTabs .settings-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('#managerBody .settings-tab-panel').forEach((p) => { p.hidden = true; });
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.tab);
            if (panel) panel.hidden = false;
        });
    });
    el.btnSaveSettings.addEventListener('click', async () => {
        await saveSettingsFromUi();
        setGenStatus('Settings saved.', 'done');
    });
    el.themeSelect.addEventListener('change', async () => {
        await api.setSettings({ theme: el.themeSelect.value });
        settings = await api.getSettings();
        await applyTheme(el.themeSelect.value);
        setGenStatus(`Theme: ${el.themeSelect.value}`, 'done');
    });
    el.btnThemeOpen.addEventListener('click', async () => {
        await api.openThemesDir();
    });
    el.btnThemeReload.addEventListener('click', async () => {
        await applyTheme(el.themeSelect.value);
        setGenStatus('Theme reloaded.', 'done');
    });
    el.btnRuntimeCheck.addEventListener('click', async () => {
        await loadRuntimeInfo(true);
    });
    el.btnRuntimeFixAll.addEventListener('click', fixRuntimeDeps);
    el.settingsModal.addEventListener('click', (e) => {
        if (e.target === el.settingsModal) el.settingsModal.hidden = true;
    });

    // Models folder
    el.btnModelDirBrowse.addEventListener('click', chooseModelDir);
    el.btnModelDirCreate.addEventListener('click', createModelStructure);
    el.btnModelDirDefault.addEventListener('click', createModelStructure);
    el.btnModelDirOpen.addEventListener('click', async () => {
        if (modelsState && modelsState.dir) await api.openPath(modelsState.dir);
    });
    el.selModel.addEventListener('change', onModelSelect);
    el.selVae.addEventListener('change', onVaeSelect);
    el.selTextEncoder.addEventListener('change', onTextEncoderSelect);
    el.selVisionEncoder.addEventListener('change', onVisionEncoderSelect);
    el.btnLinkModelFile.addEventListener('click', linkModelFile);
    if (el.loraApplyMode) el.loraApplyMode.addEventListener('change', async () => {
        await api.setSettings({ loraApplyMode: el.loraApplyMode.value });
        settings = await api.getSettings();
        setGenStatus(`LoRA mode: ${el.loraApplyMode.value} — restart server to apply.`, 'done');
    });

    el.btnBrowseServer.addEventListener('click', async () => {
        const p = await api.pickFile({ title: 'Select sd-server executable', filters: [{ name: 'Server executable', extensions: ['exe', '*'] }] });
        if (p) { el.serverBinary.value = p; saveSettingsFromUi(); }
    });

    el.btnGenerate.addEventListener('click', generate);
    el.btnCancel.addEventListener('click', cancelGeneration);
    el.btnRandomSeed.addEventListener('click', () => { el.seed.value = -1; });
    el.btnClearPrompt.addEventListener('click', () => { el.prompt.value = ''; el.negativePrompt.value = ''; });
    el.btnStyleReload.addEventListener('click', async () => { await loadStyles(); setGenStatus('Styles reloaded.', 'done'); });
    el.btnStyleOpen.addEventListener('click', async () => { await api.openStylesFile(); });
    el.styleSelect.addEventListener('change', () => {
        handleStyleChange();
        updateStylePickerLabel();
    });
    el.stylePickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.stylePopover.hidden) openStylePopover();
        else closeStylePopover();
    });
    el.stylePopoverSearch.addEventListener('input', renderStyleList);
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('stylePicker');
        if (!el.stylePopover.hidden && picker && !picker.contains(e.target)) closeStylePopover();
    });
    el.stylePopover.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeStylePopover();
            el.stylePickerBtn.focus();
        }
    });
    el.sizeMode.addEventListener('change', applySizeMode);
    el.ratioPreset.addEventListener('change', syncRatioFields);
    el.ratioW.addEventListener('input', () => {
        if (el.ratioPreset.value !== 'custom') el.ratioPreset.value = 'custom';
        el.ratioCustom.hidden = false;
        updateComputedSize();
    });
    el.ratioH.addEventListener('input', () => {
        if (el.ratioPreset.value !== 'custom') el.ratioPreset.value = 'custom';
        el.ratioCustom.hidden = false;
        updateComputedSize();
    });
    el.megapixels.addEventListener('input', updateComputedSize);
    el.width.addEventListener('input', () => { el.width.value = snapTo8(parseInt(el.width.value, 10) || 512); });
    el.height.addEventListener('input', () => { el.height.value = snapTo8(parseInt(el.height.value, 10) || 512); });
    el.btnClearGallery.addEventListener('click', () => { galleryItems = []; renderGallery(); });
    el.btnOpenGalleryDir.addEventListener('click', async () => {
        const dir = await ensureGalleryDir();
        if (dir) await api.openPath(dir);
    });

    // persist on change (backend + auto-saved generation parameters)
    const persistFields = [
        el.listenHost, el.listenPort, el.extraArgs, el.autoStart,
        el.steps, el.cfgScale, el.seed, el.batchCount,
        el.sampler, el.scheduler, el.outputFormat,
    ];
    for (const f of persistFields) {
        const ev = f.type === 'checkbox' ? 'change' : 'change';
        f.addEventListener(ev, () => saveSettingsFromUi());
    }
}

// ---------- IPC subscriptions ----------
function subscribe() {
    api.onBackendUpdate((patch) => {
        if (patch.type === 'log') {
            logLine(patch.entry);
            if (activeJob && !el.genProgressCard.hidden) {
                const pct = progressFromLog(patch.entry.message);
                if (pct != null) {
                    showProgress(false, el.genProgressText.textContent || 'Generating...', pct);
                }
            }
            return;
        }
        if (patch.type === 'state') {
            backendState = patch;
            renderBackendState();
        }
    });

    api.onDownloadProgress((p) => {
        el.progressWrap.hidden = false;
        const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
        el.progressFill.style.width = `${pct}%`;
        el.progressText.textContent = `${fmtBytes(p.received)} / ${fmtBytes(p.total)} (${pct}%)`;
    });

    api.onRuntimeFixProgress((p) => {
        const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
        setRuntimeProgress(p.message || `${p.phase || ''}...`, pct);
    });

    api.onDataMigrateProgress((p) => {
        el.dataMigrateWrap.hidden = false;
        const pct = p.total ? Math.round((p.copied / p.total) * 100) : 100;
        el.dataMigrateFill.style.width = `${pct}%`;
        el.dataMigrateText.textContent = `Copying app data... ${fmtBytes(p.copied)} / ${fmtBytes(p.total)} (${pct}%)`;
    });

    api.onServerReady(() => {
        setGenStatus('Server ready.', 'done');
        loadCapabilities();
    });
}

// ---------- Capabilities ----------
async function loadCapabilities() {
    const res = await api.getCapabilities();
    if (!res.ok) return;
    capabilities = res.caps;
    if (Array.isArray(capabilities.samplers) && capabilities.samplers.length) {
        populateSelect(el.sampler, capabilities.samplers, 'euler_a');
    }
    if (Array.isArray(capabilities.schedulers) && capabilities.schedulers.length) {
        populateSelect(el.scheduler, capabilities.schedulers, 'discrete');
    }
    if (capabilities.defaults) {
        const d = capabilities.defaults;
        if (d.sample_params) {
            // Only apply server defaults to untouched fields. Never clobber the
            // values the user chose, otherwise every re-ready resets their steps/CFG.
            if (d.sample_params.sample_steps && el.steps.value.trim() === '') {
                el.steps.value = d.sample_params.sample_steps;
            }
            if (d.sample_params.guidance && d.sample_params.guidance.txt_cfg != null && el.cfgScale.value.trim() === '') {
                el.cfgScale.value = d.sample_params.guidance.txt_cfg;
            }
        }
    }
}

function populateSelect(select, values, fallback) {
    const current = select.value;
    select.innerHTML = '';
    for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    }
    const target = values.includes(current) ? current : fallback;
    if (target && values.includes(target)) {
        select.value = target;
    }
}

// ---------- Runtime & GPU detection ----------
let runtimeState = null;

function fmtVram(mb) {
    if (!mb) return 'unknown VRAM';
    if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
    return `${mb} MB`;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function runtimeChip(className, text) {
    return `<span class="runtime-chip ${className}">${esc(text)}</span>`;
}

async function loadRuntimeInfo(manual) {
    if (manual) setRuntimeProgress('Scanning runtime & GPU...', 0);
    const res = await api.getRuntimeInfo();
    if (res.ok) {
        runtimeState = res.info;
        renderRuntimeInfo(res.info);
        if (manual) {
            setRuntimeProgress(res.info.deps.ok ? 'Runtime looks good.' : 'Issues found. See details below.', 100);
        }
    } else {
        el.runtimeInfo.innerHTML = `<p class="muted">Check failed: ${esc(res.error)}</p>`;
    }
    setTimeout(() => {
        el.runtimeProgressWrap.hidden = true;
    }, 2500);
    return res;
}

function renderRuntimeInfo(info) {
    const fixable = (info.deps.deps || []).filter((d) => d.fixable && d.missingFiles && d.missingFiles.length);
    el.btnRuntimeFixAll.disabled = !fixable.length;
    el.btnRuntimeFixAll.textContent = fixable.length ? `Download missing (${fixable.length})` : 'Download missing';

    const platform = info.platform;
    const platformLabel = `${platform.platform === 'win32' ? 'Windows' : platform.platform === 'darwin' ? 'macOS' : platform.platform === 'linux' ? 'Linux' : platform.platform} ${platform.arch}${platform.windowsVersion ? ' ' + platform.windowsVersion : ''}`;

    let html = '';
    html += `<div class="runtime-line"><span class="runtime-label">Platform</span> ${runtimeChip('neutral', platformLabel)}</div>`;

    if (info.gpus && info.gpus.length) {
        const gpuChips = info.gpus
            .map((g) => runtimeChip(g.virtual ? 'virtual' : 'gpu', `${g.name} · ${fmtVram(g.vramMB)}`))
            .join(' ');
        html += `<div class="runtime-line"><span class="runtime-label">GPU${info.gpus.length > 1 ? 's' : ''}</span> ${gpuChips}</div>`;
    } else {
        html += `<div class="runtime-line"><span class="runtime-label">GPU</span> ${runtimeChip('neutral', 'none detected')}</div>`;
    }

    const variantClass = info.variant.variant === 'none' ? 'error' : 'variant';
    html += `<div class="runtime-line"><span class="runtime-label">Backend build</span> ${runtimeChip(variantClass, info.variant.label)}</div>`;

    const devices = info.devices || [];
    if (devices.length) {
        const chips = devices.map((d) => runtimeChip(/^cpu$/i.test(d.name) ? 'cpu' : 'gpu', d.name)).join(' ');
        html += `<div class="runtime-line"><span class="runtime-label">Devices (--list-devices)</span> ${chips}</div>`;
    } else {
        html += `<div class="runtime-line"><span class="runtime-label">Devices (--list-devices)</span> ${runtimeChip('neutral', 'unavailable')}</div>`;
    }

    if (info.gpuSilent) {
        html += `<div class="runtime-warn">Your GPU was detected, but sd-server only sees a CPU device. This usually means a runtime library is missing (below). Download missing files, then press <b>Check</b> again.</div>`;
    }

    const deps = info.deps && info.deps.deps ? info.deps.deps : [];
    html += `<div class="runtime-label" style="margin-top:10px">Runtime files</div>`;
    if (!deps.length) {
        html += `<div class="runtime-line">${runtimeChip('ok', 'all required runtime files present')}</div>`;
    } else {
        for (const d of deps) {
            const badge = d.fixable ? runtimeChip('error', 'missing') : runtimeChip('warn', 'manual');
            const files = (d.missingFiles || []).map((f) => `<code>${esc(f)}</code>`).join(', ');
            html += `<div class="runtime-line"><span class="runtime-label">${esc(d.label)}</span> ${badge}</div>`;
            if (files) html += `<div class="runtime-files">${files}</div>`;
            html += `<div class="runtime-desc">${esc(d.description)}</div>`;
            if (d.fixable) {
                html += `<button class="btn btn-sm" data-runtime-fix="${esc(d.id)}">Download &amp; fix</button>`;
            }
        }
    }

    el.runtimeInfo.innerHTML = html;

    el.runtimeInfo.querySelectorAll('[data-runtime-fix]').forEach((btn) => {
        btn.addEventListener('click', () => fixRuntimeDeps(btn.dataset.runtimeFix));
    });
}

function setRuntimeProgress(text, pct) {
    el.runtimeProgressWrap.hidden = false;
    el.runtimeProgressFill.style.width = `${pct || 0}%`;
    el.runtimeProgressText.textContent = text;
}

async function fixRuntimeDeps(onlyGroup) {
    const groups = (runtimeState && runtimeState.deps && runtimeState.deps.deps) || [];
    const targets = groups.filter((d) => d.fixable && d.missingFiles && d.missingFiles.length && (!onlyGroup || d.id === onlyGroup));
    if (!targets.length) return;
    el.btnRuntimeFixAll.disabled = true;
    el.btnRuntimeCheck.disabled = true;
    try {
        for (const group of targets) {
            setRuntimeProgress(`Downloading ${group.label}...`, 10);
            const res = await api.fixRuntimeDep(group.id);
            if (res.ok) {
                setRuntimeProgress(`Installed ${res.result.installed.join(', ') || 'files'}.`, 100);
            } else {
                setRuntimeProgress(`Failed: ${res.error}`, 100);
                setGenStatus(`Runtime fix failed: ${res.error}`, 'error');
                return;
            }
        }
        setGenStatus('Runtime files installed.', 'done');
    } finally {
        el.btnRuntimeFixAll.disabled = false;
        el.btnRuntimeCheck.disabled = false;
        await loadRuntimeInfo(false);
        setTimeout(() => {
            el.runtimeProgressWrap.hidden = true;
        }, 2000);
    }
}

// ---------- Init ----------
async function init() {
    bindEvents();
    subscribe();
    settings = await api.getSettings();
    applySettingsToUi();
    await loadDataInfo();
    await loadStyles();
    await loadThemes();
    await applyTheme(settings.theme || 'neutral');
    await refreshModels();
    const state = await api.getBackendState();
    backendState = state;
    renderBackendState();
    for (const entry of state.logs || []) logLine(entry);
    if (backendState.status === 'running') {
        loadCapabilities();
    }
    loadRuntimeInfo(false);
}

init();
