'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SettingsStore } = require('./src/settings');
const { BackendManager, findServerExecutable, validateBackendDir } = require('./src/backend');
const { ServerApiClient } = require('./src/api');
const { loadStyles, getStylesFilePath } = require('./src/styles');
const models = require('./src/models');
const releases = require('./src/releases');
const themes = require('./src/themes');
const runtime = require('./src/runtime');
const dataDir = require('./src/dataDir');

// Isolate the E2E test so it never touches the user's real settings/data.
if (process.env.SDCPP_E2E === '1') {
    app.setPath('userData', path.join(os.tmpdir(), 'sdcpp-e2e-userdata'));
    try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {}
}

// Apply the user's self-contained app-data folder before anything reads
// app.getPath('userData') (SettingsStore, themes, styles, backends, ...).
dataDir.applyDataDir();

let mainWindow = null;
const settings = new SettingsStore();
const backend = new BackendManager(settings);
const api = new ServerApiClient(backend.getServerUrl(), (msg) => backend.log('api', msg));

// Keep the API client URL in sync with settings (host/port edits).
function refreshApiBaseUrl() {
    api.setBaseUrl(backend.getServerUrl());
}
settingsRefreshApiHook();
function settingsRefreshApiHook() {
    const origSetAll = settings.setAll.bind(settings);
    settings.setAll = (patch) => {
        origSetAll(patch);
        refreshApiBaseUrl();
    };
    const origSet = settings.set.bind(settings);
    settings.set = (key, value) => {
        origSet(key, value);
        refreshApiBaseUrl();
    };
}

// --- Server readiness polling -------------------------------------------

let readinessTimer = null;
let lastReadiness = false;

function stopReadinessPoll() {
    if (readinessTimer) {
        clearInterval(readinessTimer);
        readinessTimer = null;
    }
    lastReadiness = false;
}

function startReadinessPoll() {
    stopReadinessPoll();
    readinessTimer = setInterval(async () => {
        try {
            const ok = await api.ping();
            if (ok && !lastReadiness) {
                lastReadiness = true;
                backend.status = 'running';
                backend.runningUrl = api.baseUrl;
                backend.log('info', `Server ready at ${api.baseUrl}`);
                backend.emit({ type: 'state', ...backend.getState() });
                sendToRenderer('server:ready', { url: api.baseUrl });
            } else if (!ok && lastReadiness) {
                lastReadiness = false;
                backend.emit({ type: 'state', ...backend.getState() });
            }
        } catch (err) {
            // ignore, keep polling
        }
    }, 1000);
}

// --- Backend state propagation to renderer -------------------------------

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

backend.onUpdate((patch) => {
    if (patch.type === 'state' && (patch.status === 'error' || patch.status === 'stopped')) {
        stopReadinessPoll();
    }
    sendToRenderer('backend:update', patch);
});

// --- Window lifecycle ----------------------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 950,
        minWidth: 1100,
        minHeight: 700,
        title: 'SD.cpp Studio',
        backgroundColor: '#0f1115',
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        autoHideMenuBar: true,
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (process.env.SDCPP_SMOKE === '1') {
        runSmokeCheck();
    }
    if (process.env.SDCPP_E2E === '1') {
        runE2ECheck();
    }
}

function runSmokeCheck() {
    const errors = [];
    mainWindow.webContents.on('console-message', (e, level, message) => {
        if (level >= 2) {
            errors.push(`renderer-console: ${message}`);
        }
    });
    mainWindow.webContents.on('preload-error', (e, p, err) => errors.push(`preload: ${err.message}`));
    mainWindow.webContents.on('render-process-gone', (e, details) => errors.push(`render-gone: ${details.reason}`));

    setTimeout(async () => {
        try {
            const hasBridge = await mainWindow.webContents.executeJavaScript('typeof window.sdcpp !== "undefined"');
            const state = await backend.getState();
            const result = { hasBridge, stateStatus: state.status, errors, failed: !hasBridge || errors.length > 0 };
            console.log('SMOKE_RESULT:' + JSON.stringify(result));
            app.exit(result.failed ? 1 : 0);
        } catch (err) {
            console.log('SMOKE_RESULT:' + JSON.stringify({ errors, failed: true, exception: err.message }));
            app.exit(1);
        }
    }, 3000);
}

function runE2ECheck() {
    const errors = [];
    const MOCK_PORT = parseInt(process.env.SDCPP_E2E_PORT || '7777', 10);
    const MODELS_DIR = path.join(os.tmpdir(), 'sdcpp-e2e-models');
    const IMPORT_DIR = path.join(os.tmpdir(), 'sdcpp-e2e-import');
    try { fs.rmSync(MODELS_DIR, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(IMPORT_DIR, { recursive: true, force: true }); } catch {}
    try { fs.mkdirSync(IMPORT_DIR, { recursive: true }); } catch {}
    mainWindow.webContents.on('console-message', (e, level, message) => {
        if (level >= 2) {
            errors.push(`renderer-console: ${message}`);
        }
    });
    mainWindow.webContents.on('preload-error', (e, p, err) => errors.push(`preload: ${err.message}`));

    mainWindow.webContents.once('did-finish-load', async () => {
        try {
            // Point the app at the mock server
            settings.set('listenHost', '127.0.0.1');
            settings.set('listenPort', MOCK_PORT);
            settings.set('autoStartServer', false);
            await new Promise((r) => setTimeout(r, 800));

            const result = await mainWindow.webContents.executeJavaScript(`(async () => {
                document.getElementById('listenPort').value = '${MOCK_PORT}';
                document.getElementById('listenPort').dispatchEvent(new Event('change'));

                // --- Link backend folder flow ---
                const fakeBackendDir = ${JSON.stringify(path.join(os.tmpdir(), 'sdcpp-e2e-backend'))};
                await window.sdcpp.createModelsStructure(fakeBackendDir);
                await window.sdcpp.writeFile(fakeBackendDir + '/sd-server.exe', [1, 2, 3]);
                const linkRes = await window.sdcpp.linkBackendDir(fakeBackendDir);
                const linkOk = !!(linkRes.ok && linkRes.backendDir === fakeBackendDir && linkRes.serverPath);

                // --- Models folder flow ---
                const tempModels = ${JSON.stringify(MODELS_DIR)};
                const created = await window.sdcpp.createModelsStructure(tempModels);
                const structureOk = created.ok && !!(created.subDirs
                    && created.subDirs.models && created.subDirs.loras && created.subDirs.vae && created.subDirs.textEncoders);
                // drop a dummy model + lora file
                await window.sdcpp.writeFile(created.subDirs.models + '/test-model.safetensors', [1,2,3]);
                await window.sdcpp.writeFile(created.subDirs.models + '/test-model.gguf', [1,2,3]);
                await window.sdcpp.writeFile(created.subDirs.loras + '/test-lora.safetensors', [1,2,3]);
                await window.sdcpp.writeFile(created.subDirs.textEncoders + '/mmproj-test.gguf', [1,2,3]);
                // refresh page models state so the dropdowns are populated
                await window.refreshModels();
                const scan = await window.sdcpp.getModels();
                const detectOk = scan.ok && scan.models.length === 2 && scan.loras.length === 1;
                // select each format and confirm the right launch setting is used:
                //   .safetensors/.ckpt/.pth/.pt  ->  modelPath (-m, unified)
                //   .gguf/.bin                   ->  diffusionModelPath (--diffusion-model)
                const ggufModel = scan.models.find((m) => m.name === 'test-model.gguf');
                const stModel = scan.models.find((m) => m.name === 'test-model.safetensors');
                const selModel = document.getElementById('selModel');
                const modelOpts = selModel.options.length;
                selModel.value = stModel.path;
                selModel.dispatchEvent(new Event('change'));
                await new Promise(r => setTimeout(r, 200));
                const selState = await window.sdcpp.getSettings();
                const unifiedOk = selState.modelPath === stModel.path && !selState.diffusionModelPath;
                selModel.value = ggufModel.path;
                selModel.dispatchEvent(new Event('change'));
                await new Promise(r => setTimeout(r, 200));
                const ggufState = await window.sdcpp.getSettings();
                const diffusionOk = ggufState.diffusionModelPath === ggufModel.path && !ggufState.modelPath;

                // Vision encoder: detected in text_encoders/ and selectable
                const visionSelect = document.getElementById('selVisionEncoder');
                const visionOpts = visionSelect ? visionSelect.options.length : 0;
                const visionOk = scan.ok
                    && Array.isArray(scan.visionEncoders)
                    && scan.visionEncoders.some((f) => /mmproj/i.test(f.name))
                    && visionSelect
                    && Array.from(visionSelect.options).some((o) => /mmproj/i.test(o.value));

                // --- Import model by link (symlink/hardlink from anywhere) ---
                const importSrc = ${JSON.stringify(path.join(IMPORT_DIR, 'imported-model.safetensors'))};
                await window.sdcpp.writeFile(importSrc, [1, 2, 3, 4]);
                const importLinkRes = await window.sdcpp.linkModelFile({ type: 'diffusion', filePath: importSrc });
                const importLinkScan = await window.sdcpp.getModels();
                const importLinkOk = importLinkRes.ok && !importLinkRes.canceled
                    && Array.isArray(importLinkScan.models)
                    && importLinkScan.models.some((f) => f.name === 'imported-model.safetensors');
                // the link button + type dropdown exist in the UI
                const importLinkUiOk = !!document.getElementById('btnLinkModelFile')
                    && !!document.getElementById('linkModelType');

                // --- generation ---
                document.getElementById('prompt').value = 'a red cube on a table';
                document.getElementById('steps').value = '8';
                document.getElementById('cfgScale').value = '5.5';

                const sizeMode = document.getElementById('sizeMode');
                sizeMode.value = 'ratio';
                sizeMode.dispatchEvent(new Event('change'));
                const preset = document.getElementById('ratioPreset');
                preset.value = '16:9';
                preset.dispatchEvent(new Event('change'));
                const mp = document.getElementById('megapixels');
                mp.value = '1';
                mp.dispatchEvent(new Event('input'));
                const computed = document.getElementById('computedSize').textContent;
                const eff = window.computeEffectiveSize();
                const ratioSizeOk = eff.width === 1336 && eff.height === 752;

                const styleSel = document.getElementById('styleSelect');
                const styleCount = styleSel.options.length;
                document.getElementById('prompt').value = 'a red cube on a table';
                styleSel.value = '2';
                styleSel.dispatchEvent(new Event('change'));
                const effPrompt = window.getEffectivePrompt();
                const styleApplied = effPrompt.prompt.includes('cinematic')
                    && effPrompt.prompt.includes('a red cube on a table');

                sizeMode.value = 'manual';
                sizeMode.dispatchEvent(new Event('change'));
                document.getElementById('width').value = '512';
                document.getElementById('height').value = '512';
                document.getElementById('steps').value = '8';

                // LoRA slots: add a slot and pick the detected lora
                const slotsBefore = document.querySelectorAll('#loraSlots .lora-slot').length;
                document.getElementById('btnAddLora').click();
                const slotsAfter = document.querySelectorAll('#loraSlots .lora-slot').length;
                const loraSelect = document.querySelector('#loraSlots .lora-slot select');
                const loraOpts = loraSelect ? loraSelect.options.length : 0;
                const loraSlotOk = slotsAfter === slotsBefore + 1
                    && slotsAfter >= 1
                    && loraSelect
                    && Array.from(loraSelect.options).some((o) => o.value === scan.loras[0].path);
                if (loraSelect) {
                    loraSelect.value = scan.loras[0].path;
                    loraSelect.dispatchEvent(new Event('change'));
                }
                const loraSlider = document.querySelector('#loraSlots .lora-slot input[type="range"]');
                if (loraSlider) loraSlider.value = '1.2';
                const loraStrengthOk = !!loraSlider && loraSlider.max === '2' && loraSlider.value === '1.2';

                // Edit mode: switch mode, set a reference image + strength, build payload
                window.setEditMode(true);
                window.setInitImageData('test-edit.png', 'data:image/png;base64,AAAA', 640, 384);
                const editPanelVisible = document.getElementById('editPanel').hidden === false;
                const strengthInput = document.getElementById('editStrength');
                strengthInput.value = '0.6';
                strengthInput.dispatchEvent(new Event('input'));
                const editPayload = window.buildNativePayload();
                const editOk = editPanelVisible
                    && editPayload
                    && Array.isArray(editPayload.ref_images)
                    && editPayload.ref_images[0] === 'data:image/png;base64,AAAA'
                    && editPayload.strength === 0.6
                    && editPayload.width === 640 && editPayload.height === 384
                    && !('init_image' in editPayload);
                window.setEditMode(false);
                const editClearedOk = document.getElementById('editPanel').hidden === true;

                const jobRes = await window.sdcpp.submitJob({
                    prompt: 'a red cube on a table',
                    negative_prompt: '',
                    width: 512, height: 512, seed: -1, batch_count: 1,
                    sample_params: { scheduler: 'discrete', sample_method: 'euler_a', sample_steps: 8, guidance: { txt_cfg: 5.5 } },
                    lora: [], output_format: 'png', output_compression: 100
                });
                const jobId = jobRes.job.id;
                let jobState = null;
                for (let i = 0; i < 8; i++) {
                    await new Promise(r => setTimeout(r, 400));
                    const j = await window.sdcpp.getJob(jobId);
                    if (j.job.status === 'completed') { jobState = j.job; break; }
                }
                return {
                    loraSlotOk,
                    loraStrengthOk,
                    editOk,
                    editClearedOk,
                    jobOk: !!jobRes.ok,
                    jobStatus: jobState ? jobState.status : null,
                    hasImages: !!(jobState && jobState.result && jobState.result.images && jobState.result.images.length),
                    ratioSizeOk,
                    computed,
                    eff,
                    styleCount,
                    styleApplied,
                    structureOk,
                    detectOk,
                    modelOpts,
                    unifiedOk,
                    diffusionOk,
                    visionOk,
                    importLinkOk,
                    importLinkUiOk,
                    importLinkRes,
                    importLinkScan,
                };
            })()`);

            const checks = result.jobStatus === 'completed' && result.hasImages
                && result.ratioSizeOk && result.styleApplied
                && result.structureOk && result.detectOk && result.unifiedOk && result.diffusionOk
                && result.visionOk
                && result.importLinkOk && result.importLinkUiOk
                && result.loraSlotOk && result.loraStrengthOk
                && result.editOk && result.editClearedOk
                && errors.length === 0;
            console.log('E2E_RESULT:' + JSON.stringify({ ...result, errors, failed: !checks }));
            app.exit(checks ? 0 : 1);
        } catch (err) {
            console.log('E2E_RESULT:' + JSON.stringify({ errors, failed: true, exception: err.message }));
            app.exit(1);
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    // Auto start server if configured
    const backendDir = settings.get('backendDir');
    if (backendDir && findServerExecutable(backendDir).length > 0 && settings.get('autoStartServer')) {
        setTimeout(async () => {
            const res = await backend.start(); if (res && res.url) { api.setBaseUrl(res.url); startReadinessPoll(); }
        }, 1500);
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    stopReadinessPoll();
    backend.dispose();
});

// --- IPC: settings -------------------------------------------------------

ipcMain.handle('settings:get', () => settings.data);
ipcMain.handle('settings:set', (e, patch) => {
    settings.setAll(patch || {});
    return settings.data;
});

// --- IPC: models (folder-based) -----------------------------------------

ipcMain.handle('models:get', () => {
    const dir = settings.get('modelDir') || '';
    return { ok: true, ...models.scan(dir) };
});

ipcMain.handle('models:chooseDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Select model folder',
        properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: true, canceled: true };
    return { ok: true, canceled: false, dir: res.filePaths[0] };
});

ipcMain.handle('models:setDir', (e, dir) => {
    settings.set('modelDir', dir || '');
    return { ok: true, ...models.scan(settings.get('modelDir') || '') };
});

ipcMain.handle('models:createStructure', (e, dir) => {
    const target = dir || settings.get('modelDir');
    if (!target) return { ok: false, error: 'No model folder selected' };
    try {
        const created = models.createStructure(target);
        settings.set('modelDir', target);
        return { ok: true, created, ...models.scan(target) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('models:checkFiles', (e, paths) => {
    const results = [];
    for (const p of (paths || []).filter(Boolean)) {
        const name = path.basename(p);
        try {
            const st = fs.statSync(p);
            results.push({ path: p, name, exists: true, size: st.size, empty: st.size === 0 });
        } catch {
            results.push({ path: p, name, exists: false, size: 0, empty: true, missing: true });
        }
    }
    return results;
});

ipcMain.handle('models:linkFile', async (e, opts) => {
    const type = (opts && opts.type) || 'diffusion';
    const dir = settings.get('modelDir') || '';
    const filters = { name: 'Model files', extensions: models.EXTENSIONS.models };
    if (type === 'lora') filters.extensions = models.EXTENSIONS.loras;
    else if (type === 'vae') filters.extensions = models.EXTENSIONS.vae;
    else if (type === 'textEncoder' || type === 'visionEncoder') filters.extensions = models.EXTENSIONS.textEncoders;

    let filePath = opts && opts.filePath;
    if (!filePath) {
        const res = await dialog.showOpenDialog(mainWindow, {
            title: 'Link model file into the models folder',
            properties: ['openFile'],
            filters: [filters],
        });
        if (res.canceled || !res.filePaths.length) return { ok: true, canceled: true };
        filePath = res.filePaths[0];
    }

    const link = models.linkModelFile(filePath, type, dir);
    if (!link.ok) return link;
    return { ok: true, canceled: false, ...link, scan: models.scan(dir) };
});

ipcMain.handle('models:deleteFile', async (e, filePath) => {
    const dir = settings.get('modelDir') || '';
    if (!filePath) return { ok: false, error: 'No file specified.' };
    if (!dir) return { ok: false, error: 'No models folder configured.' };
    const resolvedFile = path.resolve(filePath);
    const resolvedDir = path.resolve(dir);
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        return { ok: false, error: 'Refusing to delete file outside the models folder.' };
    }
    let stat;
    try { stat = fs.lstatSync(resolvedFile); } catch { return { ok: false, error: 'File not found.' }; }
    if (!stat.isFile() && !stat.isSymbolicLink()) return { ok: false, error: 'Only files can be deleted.' };
    try {
        // Prefer trash (recoverable)
        let trashed = false;
        try {
            await shell.trashItem(resolvedFile);
            trashed = true;
        } catch {}
        if (!trashed && fs.existsSync(resolvedFile)) {
            const res = models.deleteModelFile(resolvedFile, dir);
            if (!res.ok) return res;
        }
        // Clear any setting that pointed to this file
        const patch = {};
        if (settings.get('modelPath') === filePath || settings.get('modelPath') === resolvedFile) patch.modelPath = '';
        if (settings.get('diffusionModelPath') === filePath || settings.get('diffusionModelPath') === resolvedFile) patch.diffusionModelPath = '';
        if (settings.get('vaePath') === filePath || settings.get('vaePath') === resolvedFile) patch.vaePath = '';
        if (settings.get('textEncoderPath') === filePath || settings.get('textEncoderPath') === resolvedFile) patch.textEncoderPath = '';
        if (settings.get('visionEncoderPath') === filePath || settings.get('visionEncoderPath') === resolvedFile) patch.visionEncoderPath = '';
        if (Object.keys(patch).length) settings.setAll(patch);
        // Also purge from loraSlots
        const slots = settings.get('loraSlots') || [];
        const filtered = slots.filter((s) => s.path !== filePath && s.path !== resolvedFile);
        if (filtered.length !== slots.length) settings.set('loraSlots', filtered);
        return { ok: true, scan: models.scan(dir) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// --- IPC: style templates ------------------------------------------------

ipcMain.handle('styles:get', () => {
    try {
        const data = loadStyles();
        return { ok: true, filePath: data.filePath, styles: data.styles };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('styles:openFile', async () => {
    try {
        const filePath = getStylesFilePath();
        const res = await shell.openPath(filePath);
        return { ok: res === '', filePath };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('theme:list', () => {
    try {
        return { ok: true, themes: themes.listThemes() };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('theme:get', (e, name) => {
    try {
        return { ok: true, name: name || null, css: themes.getThemeCss(name) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('theme:openDir', () => {
    try {
        const dir = themes.openThemesDir();
        return { ok: true, dir };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// --- IPC: backend --------------------------------------------------------

ipcMain.handle('backend:state', () => backend.getState());

ipcMain.handle('backend:listReleaseAssets', async (e, { page } = {}) => {
    try {
        const rels = await releases.getReleases(page || 1, 5);
        return { ok: true, releases: rels };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('backend:latestRelease', async () => {
    try {
        const rel = await releases.getLatestRelease();
        return { ok: true, release: rel };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('backend:downloadAsset', async (e, { assetUrl, assetName, tag }) => {
    try {
        const asset = {
            url: assetUrl,
            name: assetName,
            tag,
        };
        const serverPath = await backend.installReleaseAsset(asset, (progress) => {
            sendToRenderer('backend:downloadProgress', {
                assetName,
                received: progress.received,
                total: progress.total,
            });
        });
        return { ok: true, serverPath };
    } catch (err) {
        backend.log('error', err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('backend:importZip', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Import stable-diffusion.cpp release zip',
        properties: ['openFile'],
        filters: [
            { name: 'Zip archives', extensions: ['zip'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (res.canceled || !res.filePaths.length) {
        return { ok: false, canceled: true };
    }
    try {
        const serverPath = await backend.importBackendZip(res.filePaths[0]);
        return { ok: true, serverPath };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('backend:chooseZip', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Select stable-diffusion.cpp release zip',
        properties: ['openFile'],
        filters: [{ name: 'Zip archives', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths.length) {
        return { ok: false, canceled: true };
    }
    return { ok: true, path: res.filePaths[0] };
});

// Link an already-extracted backend folder directly (no copy).
ipcMain.handle('backend:linkFolder', async (e, dir) => {
    let target = dir;
    if (!target) {
        const res = await dialog.showOpenDialog(mainWindow, {
            title: 'Select the extracted backend folder (must contain sd-server)',
            properties: ['openDirectory'],
        });
        if (res.canceled || !res.filePaths.length) {
            return { ok: false, canceled: true };
        }
        target = res.filePaths[0];
    }
    const check = validateBackendDir(target);
    if (!check.ok) {
        return { ok: false, error: check.error };
    }
    const serverPath = backend.setBackendDir(target);
    return { ok: true, serverPath, backendDir: target };
});

ipcMain.handle('backend:start', async () => {
    try {
        const result = await backend.start();
        if (result.alreadyRunning) {
            return { ok: true, alreadyRunning: true, url: result.url };
        }
        api.setBaseUrl(result.url);
        startReadinessPoll();
        return { ok: true, url: result.url };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('backend:stop', async () => {
    await backend.stop();
    stopReadinessPoll();
    return { ok: true };
});

ipcMain.handle('backend:validateDir', async (e, dir) => {
    if (!dir || !fs.existsSync(dir)) {
        return { ok: false, error: 'Directory does not exist' };
    }
    const check = validateBackendDir(dir);
    return check;
});

// --- IPC: runtime & GPU detection ---------------------------------------

ipcMain.handle('runtime:info', async () => {
    try {
        const info = await runtime.getRuntimeInfo(settings.get('backendDir'));
        return { ok: true, info };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('runtime:fix', async (e, groupId) => {
    try {
        const backendDir = settings.get('backendDir');
        let lastPct = -1;
        let lastPhase = null;
        const result = await runtime.fixDependency(backendDir, groupId, (progress) => {
            const pct = progress.total ? Math.round((progress.received / progress.total) * 100) : -1;
            // Throttle progress IPC so we don't spam hundreds of events per second.
            if (progress.phase !== lastPhase || pct < 0 || pct !== lastPct) {
                lastPhase = progress.phase;
                lastPct = pct;
                sendToRenderer('runtime:fixProgress', { groupId, ...progress });
            }
        });
        return { ok: true, result };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// --- IPC: file/dir pickers ----------------------------------------------

ipcMain.handle('dialog:pickFile', async (e, opts) => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: opts && opts.title ? opts.title : 'Select a file',
        properties: ['openFile'],
        filters: opts && opts.filters ? opts.filters : [],
    });
    if (res.canceled || !res.filePaths.length) {
        return null;
    }
    return res.filePaths[0];
});

ipcMain.handle('dialog:pickImage', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose an image to edit',
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (res.canceled || !res.filePaths.length) {
        return { ok: false, canceled: true };
    }
    try {
        const filePath = res.filePaths[0];
        const buf = fs.readFileSync(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'webp' ? 'image/webp'
            : ext === 'bmp' ? 'image/bmp'
            : 'image/png';
        return {
            ok: true,
            name: path.basename(filePath),
            base64: buf.toString('base64'),
            dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('dialog:pickDirectory', async (e, opts) => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: opts && opts.title ? opts.title : 'Select a directory',
        properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) {
        return null;
    }
    return res.filePaths[0];
});

ipcMain.handle('dialog:saveImage', async (e, { defaultName }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Save generated image',
        defaultPath: defaultName || 'generated.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (res.canceled || !res.filePath) {
        return null;
    }
    return res.filePath;
});

ipcMain.handle('shell:openPath', async (e, target) => {
    if (!target) return;
    shell.openPath(target);
});

// --- IPC: app data folder (self-contained data root) ---------------------

ipcMain.handle('data:get', () => dataDir.getDataDirInfo());

ipcMain.handle('data:set', async (e, dir) => {
    try {
        const current = dataDir.getDataDirInfo().current;
        if (dir && path.resolve(dir) === path.resolve(current)) {
            return { ok: false, error: 'That is already the app data folder.' };
        }
        const mig = await dataDir.migrate(current, dir, (p) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('data:migrateProgress', p);
            }
        });
        if (!mig.ok) return mig;
        const set = dataDir.setDataDir(dir);
        if (!set.ok) return set;
        setTimeout(() => {
            app.relaunch();
            app.exit(0);
        }, 500);
        return { ok: true, dataDir: dir, restarting: true, migrated: mig.migrated };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('data:reset', () => {
    dataDir.resetDataDir();
    setTimeout(() => {
        app.relaunch();
        app.exit(0);
    }, 500);
    return { ok: true, restarting: true };
});

ipcMain.handle('fs:writeFile', async (e, { filePath, data }) => {
    try {
        const buf = Buffer.from(data);
        fs.writeFileSync(filePath, buf);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// --- IPC: generation -----------------------------------------------------

ipcMain.handle('gen:txt2img', async (e, payload) => {
    try {
        const result = await api.txt2img(payload);
        return { ok: true, result };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('gen:submit', async (e, payload) => {
    try {
        const job = await api.submitImageJob(payload);
        return { ok: true, job };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('gen:job', async (e, jobId) => {
    try {
        const job = await api.getJob(jobId);
        return { ok: true, job };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('gen:cancel', async (e, jobId) => {
    try {
        const job = await api.cancelJob(jobId);
        return { ok: true, job };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('gen:capabilities', async () => {
    try {
        const caps = await api.getCapabilities();
        return { ok: true, caps };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('gen:loras', async () => {
    try {
        const loras = await api.getLoras();
        return { ok: true, loras };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});
