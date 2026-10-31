'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const EXECUTABLE_NAME = process.platform === 'win32' ? 'sd-server.exe' : 'sd-server';

function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Downloads a file with progress reporting.
 * @returns Promise resolving to local file path.
 */
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const tmp = dest + '.part';
        const stream = fs.createWriteStream(tmp);
        let received = 0;

        const httpGet = (currentUrl, redirects = 0) => {
            if (redirects > 10) {
                reject(new Error('Too many redirects'));
                return;
            }
            https.get(currentUrl, { headers: { 'User-Agent': 'SDCppStudio/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    httpGet(new URL(res.headers.location, currentUrl).toString(), redirects + 1);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${res.statusCode}`));
                    return;
                }
                const total = parseInt(res.headers['content-length'] || '0', 10);
                received = 0;
                res.on('data', (chunk) => {
                    received += chunk.length;
                    if (!stream.write(chunk) && onProgress) onProgress({ received, total });
                    else if (onProgress) onProgress({ received, total });
                });
                res.on('end', () => {
                    stream.end();
                });
                res.on('error', (err) => {
                    stream.destroy();
                    reject(err);
                });
            }).on('error', (err) => {
                stream.destroy();
                reject(err);
            });
        };

        stream.on('open', () => httpGet(url));
        stream.on('finish', () => {
            try {
                fs.renameSync(tmp, dest);
                resolve(dest);
            } catch (err) {
                reject(err);
            }
        });
        stream.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Extracts a zip file to a destination directory.
 */
function extractZip(zipPath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
    return destDir;
}

/**
 * Recursively find the sd-server executable under a directory.
 */
function findServerExecutable(dir) {
    const results = [];
    const walk = (current) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase() === EXECUTABLE_NAME.toLowerCase()) {
                results.push(full);
            }
        }
    };
    walk(dir);
    return results;
}

/**
 * Sanity check: verify a directory actually contains a working sd-server.
 */
function validateBackendDir(dir) {
    const exes = findServerExecutable(dir);
    if (exes.length === 0) {
        return { ok: false, error: `No ${EXECUTABLE_NAME} found in the extracted archive. Make sure you imported a stable-diffusion.cpp release zip.` };
    }
    return { ok: true, serverPath: exes[0], candidates: exes };
}

class BackendManager {
    constructor(settings) {
        this.settings = settings;
        this.process = null;
        this.logs = [];
        this.status = 'stopped'; // stopped | starting | running | error
        this.serverPath = null;
        this.runningUrl = null;
        this.autoStartPending = false;
        this.listeners = [];
        const initDir = this.settings.get('backendDir');
        if (initDir && fs.existsSync(initDir)) {
            const exes = findServerExecutable(initDir);
            if (exes.length) this.serverPath = exes[0];
        }
    }

    onUpdate(cb) {
        this.listeners.push(cb);
    }

    emit(patch) {
        for (const cb of this.listeners) cb(patch);
    }

    getState() {
        return {
            status: this.status,
            serverPath: this.serverPath,
            runningUrl: this.runningUrl,
            logs: this.logs.slice(-500),
            backendDir: this.settings.get('backendDir'),
        };
    }

    log(level, message) {
        const entry = { ts: Date.now(), level, message };
        this.logs.push(entry);
        if (this.logs.length > 1000) this.logs = this.logs.slice(-1000);
        this.emit({ type: 'log', entry });
    }

    /**
     * Download a release asset zip and extract it into the managed backends dir.
     * Returns the server executable path.
     */
    async installReleaseAsset(asset, onProgress) {
        const backendRoot = this.getBackendRoot();
        const tag = sanitizeName(asset.tag || 'latest');
        const assetName = sanitizeName(asset.name.replace(/\.zip$/i, ''));
        const destDir = path.join(backendRoot, `${tag}__${assetName}`);
        const zipPath = path.join(os.tmpdir(), `sdcpp-dl-${Date.now()}-${sanitizeName(asset.name)}`);

        try {
            this.log('info', `Downloading ${asset.name} (${(asset.size / 1048576).toFixed(0)} MB)...`);
            await downloadFile(asset.url, zipPath, onProgress);
            this.log('info', `Download complete. Extracting to ${destDir}...`);
            if (fs.existsSync(destDir)) {
                fs.rmSync(destDir, { recursive: true, force: true });
            }
            extractZip(zipPath, destDir);
            const check = validateBackendDir(destDir);
            if (!check.ok) {
                this.log('error', check.error);
                throw new Error(check.error);
            }
            this.settings.set('backendDir', destDir);
            this.serverPath = check.serverPath;
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(check.serverPath, 0o755);
                } catch {}
            }
            this.log('info', `Backend installed: ${check.serverPath}`);
            this.emit({ type: 'state', ...this.getState() });
            return check.serverPath;
        } finally {
            try {
                fs.rmSync(zipPath, { force: true });
            } catch {}
        }
    }

    /**
     * Import a user-supplied zip file as the backend.
     */
    async importBackendZip(zipPath) {
        const backendRoot = this.getBackendRoot();
        const assetName = sanitizeName(path.basename(zipPath, path.extname(zipPath)));
        const destDir = path.join(backendRoot, `import-${assetName}-${Date.now()}`);
        this.log('info', `Extracting ${path.basename(zipPath)} ...`);
        extractZip(zipPath, destDir);
        const check = validateBackendDir(destDir);
        if (!check.ok) {
            fs.rmSync(destDir, { recursive: true, force: true });
            this.log('error', check.error);
            throw new Error(check.error);
        }
        this.settings.set('backendDir', destDir);
        this.settings.set('lastBackendZip', zipPath);
        this.serverPath = check.serverPath;
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(check.serverPath, 0o755);
            } catch {}
        }
        this.log('info', `Backend imported: ${check.serverPath}`);
        this.emit({ type: 'state', ...this.getState() });
        return check.serverPath;
    }

    getBackendRoot() {
        const userData = require('electron').app.getPath('userData');
        const dir = path.join(userData, 'backends');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    /**
     * Point the backend at an already-extracted folder (no copy).
     * Validates it contains sd-server and updates state.
     */
    setBackendDir(dir) {
        if (!dir) return null;
        const exes = findServerExecutable(dir);
        this.settings.set('backendDir', dir);
        this.serverPath = exes[0] || null;
        this.emit({ type: 'state', ...this.getState() });
        return this.serverPath;
    }

    listInstalledBackends() {
        const root = this.getBackendRoot();
        const activeDir = this.settings.get('backendDir') || '';
        const norm = (p) => (p ? path.resolve(p).toLowerCase() : '');
        const activeNorm = norm(activeDir);

        const items = [];
        const seen = new Set();

        const detectVariant = (name, p) => {
            const str = (name + ' ' + p).toLowerCase();
            if (/cuda12|cu12/i.test(str)) return 'CUDA 12';
            if (/cuda11|cu11/i.test(str)) return 'CUDA 11';
            if (/vulkan/i.test(str)) return 'Vulkan';
            if (/rocm|hip/i.test(str)) return 'ROCm';
            if (/sycl/i.test(str)) return 'SYCL';
            if (/avx512/i.test(str)) return 'CPU AVX-512';
            if (/avx2/i.test(str)) return 'CPU AVX2';
            if (/cpu/i.test(str)) return 'CPU';
            return 'Generic';
        };

        const computeFolderSize = (folder) => {
            let total = 0;
            try {
                const stack = [folder];
                while (stack.length > 0) {
                    const curr = stack.pop();
                    const entries = fs.readdirSync(curr, { withFileTypes: true });
                    for (const entry of entries) {
                        const full = path.join(curr, entry.name);
                        if (entry.isDirectory()) stack.push(full);
                        else if (entry.isFile()) total += fs.statSync(full).size;
                    }
                }
            } catch {}
            return total;
        };

        // 1. Scan managed root
        if (fs.existsSync(root)) {
            let entries = [];
            try {
                entries = fs.readdirSync(root, { withFileTypes: true });
            } catch {}

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
                const full = path.join(root, entry.name);
                const fullNorm = norm(full);
                seen.add(fullNorm);

                const exes = findServerExecutable(full);
                let stat = null;
                try {
                    stat = fs.statSync(full);
                } catch {}

                let name = entry.name;
                if (name.includes('__')) {
                    const parts = name.split('__');
                    name = parts[1] || parts[0];
                }

                items.push({
                    id: entry.name,
                    name: name,
                    folderName: entry.name,
                    path: full,
                    serverPath: exes[0] || null,
                    isValid: exes.length > 0,
                    isActive: fullNorm === activeNorm,
                    isExternal: false,
                    variant: detectVariant(entry.name, full),
                    size: computeFolderSize(full),
                    mtime: stat ? stat.mtimeMs : 0
                });
            }
        }

        // 2. Active external backend (if outside root)
        if (activeDir && fs.existsSync(activeDir)) {
            const activePathNorm = norm(activeDir);
            if (!seen.has(activePathNorm)) {
                const exes = findServerExecutable(activeDir);
                let stat = null;
                try {
                    stat = fs.statSync(activeDir);
                } catch {}

                items.push({
                    id: 'external-active',
                    name: path.basename(activeDir),
                    folderName: path.basename(activeDir),
                    path: activeDir,
                    serverPath: exes[0] || null,
                    isValid: exes.length > 0,
                    isActive: true,
                    isExternal: true,
                    variant: detectVariant(path.basename(activeDir), activeDir),
                    size: 0,
                    mtime: stat ? stat.mtimeMs : 0
                });
            }
        }

        items.sort((a, b) => {
            if (a.isActive && !b.isActive) return -1;
            if (!a.isActive && b.isActive) return 1;
            return b.mtime - a.mtime;
        });

        return items;
    }

    setActiveBackend(targetPath) {
        if (!targetPath || !fs.existsSync(targetPath)) {
            throw new Error(`Directory does not exist: ${targetPath}`);
        }
        const check = validateBackendDir(targetPath);
        if (!check.ok) {
            throw new Error(check.error || 'Invalid backend directory (sd-server not found).');
        }
        this.settings.set('backendDir', targetPath);
        this.serverPath = check.serverPath;
        this.log('info', `Active backend set to: ${targetPath}`);
        this.emit({ type: 'state', ...this.getState() });
        return {
            ok: true,
            serverPath: check.serverPath,
            backendDir: targetPath,
            backends: this.listInstalledBackends()
        };
    }

    async deleteBackend(targetPath) {
        if (!targetPath) throw new Error('Target backend path is required');
        const norm = (p) => path.resolve(p).toLowerCase();
        const rootNorm = norm(this.getBackendRoot());
        const targetNorm = norm(targetPath);

        const isManaged = targetNorm.startsWith(rootNorm + path.sep);
        const isActive = norm(this.settings.get('backendDir') || '') === targetNorm;

        if (isActive && this.status !== 'stopped') {
            this.log('info', 'Stopping server before deleting active backend...');
            await this.stop();
        }

        if (isActive) {
            this.settings.set('backendDir', '');
            this.serverPath = null;
        }

        if (isManaged) {
            if (fs.existsSync(targetPath)) {
                this.log('info', `Deleting backend folder: ${targetPath}`);
                fs.rmSync(targetPath, { recursive: true, force: true });
            }
        }

        // If the active backend was deleted, select next available if any
        if (isActive) {
            const remaining = this.listInstalledBackends().filter((b) => b.isValid);
            if (remaining.length > 0) {
                this.setActiveBackend(remaining[0].path);
            } else {
                this.emit({ type: 'state', ...this.getState() });
            }
        } else {
            this.emit({ type: 'state', ...this.getState() });
        }

        return {
            ok: true,
            deletedPath: targetPath,
            backends: this.listInstalledBackends()
        };
    }

    /**
     * Build the CLI args to launch sd-server from current settings.
     */
    buildLaunchArgs() {
        const args = [];
        const modelPath = this.settings.get('modelPath');
        const diffusionModel = this.settings.get('diffusionModelPath');
        const loaderMode = this.settings.get('modelLoaderMode') || 'auto';
        const vaePath = this.settings.get('vaePath');
        const tePath = this.settings.get('textEncoderPath');
        const clipL = this.settings.get('clipLPath');
        const clipG = this.settings.get('clipGPath');
        const t5xxl = this.settings.get('t5xxlPath');
        const tokenizer = this.settings.get('tokenizerPath');
        const visionEncoder = this.settings.get('visionEncoderPath');
        const refImageArgs = (this.settings.get('refImageArgs') || '').trim();
        const loraDir = this.settings.get('loraDir');
        const host = this.settings.get('listenHost') || '127.0.0.1';
        const port = this.settings.get('listenPort') || 1234;

        const effectiveModel = modelPath || diffusionModel;
        if (loaderMode === 'unified' && effectiveModel) {
            args.push('-m', effectiveModel);
        } else if (loaderMode === 'diffusion' && effectiveModel) {
            args.push('--diffusion-model', effectiveModel);
        } else {
            // Auto mode
            if (modelPath) {
                args.push('-m', modelPath);
            }
            if (diffusionModel) {
                args.push('--diffusion-model', diffusionModel);
            }
        }

        if (vaePath) {
            args.push('--vae', vaePath);
        }

        // Auxiliary text encoders
        if (clipL) {
            args.push('--clip_l', clipL);
        }
        if (clipG) {
            args.push('--clip_g', clipG);
        }
        if (t5xxl) {
            args.push('--t5xxl', t5xxl);
        }

        // Primary text encoder smart routing if not already explicitly assigned
        if (tePath) {
            const teBase = path.basename(tePath).toLowerCase();
            if (/clip[-_]?l/i.test(teBase)) {
                if (!clipL) args.push('--clip_l', tePath);
            } else if (/clip[-_]?g/i.test(teBase)) {
                if (!clipG) args.push('--clip_g', tePath);
            } else if (/t5/i.test(teBase)) {
                if (!t5xxl) args.push('--t5xxl', tePath);
            } else if (/tokenizer/i.test(teBase) || teBase.endsWith('.json')) {
                if (!tokenizer) args.push('--tokenizer', tePath);
            } else {
                args.push('--llm', tePath);
            }
        }

        const extra = (this.settings.get('extraArgs') || '').trim();
        const extraTokens = extra ? extra.split(/\s+/).filter(Boolean) : [];

        let tokenizerPathToUse = tokenizer;
        const filteredExtraTokens = [];
        for (let i = 0; i < extraTokens.length; i++) {
            if (extraTokens[i] === '--tokenizer' && i + 1 < extraTokens.length) {
                if (!tokenizerPathToUse) tokenizerPathToUse = extraTokens[i + 1];
                i++;
            } else {
                filteredExtraTokens.push(extraTokens[i]);
            }
        }

        const effectiveModelName = path.basename(effectiveModel || '').toLowerCase();
        const isMossModel = /moss/i.test(effectiveModelName);

        if (!tokenizerPathToUse && isMossModel) {
            const modelsDir = this.settings.get('modelDir');
            if (modelsDir) {
                const autoTok = path.join(modelsDir, 'text_encoders', 'tokenizer.json');
                if (fs.existsSync(autoTok)) {
                    tokenizerPathToUse = autoTok;
                }
            }
        }

        if (tokenizerPathToUse) {
            if (!path.isAbsolute(tokenizerPathToUse)) {
                const modelsDir = this.settings.get('modelDir');
                if (modelsDir && fs.existsSync(path.join(modelsDir, 'text_encoders', tokenizerPathToUse))) {
                    tokenizerPathToUse = path.join(modelsDir, 'text_encoders', tokenizerPathToUse);
                }
            }
            args.push('--tokenizer', tokenizerPathToUse);
        }

        if (visionEncoder) {
            args.push('--llm_vision', visionEncoder);
        }
        if (refImageArgs) {
            args.push('--ref-image-args', refImageArgs);
        }
        if (loraDir) {
            args.push('--lora-model-dir', loraDir);
        }
        const loraMode = this.settings.get('loraApplyMode') || 'auto';
        if (loraMode && loraMode !== 'auto') {
            args.push('--lora-apply-mode', loraMode);
        }
        // Performance & memory optimizations from docs/performance.md
        const hasExtra = (flag) => extraTokens.some((t) => t === flag || t.startsWith(flag + '='));

        const flashAttn = this.settings.get('flashAttn');
        if (!hasExtra('--flash-attn') && flashAttn && flashAttn !== 'auto') {
            args.push('--flash-attn', flashAttn);
        }

        const convDirect = this.settings.get('convDirect');
        if (!hasExtra('--conv-direct') && convDirect && convDirect !== 'auto') {
            args.push('--conv-direct', convDirect);
        }

        const batchedCfg = this.settings.get('batchedCfg');
        if (!hasExtra('--batched-cfg') && batchedCfg === false) {
            args.push('--batched-cfg', 'off');
        }

        const vaeTiling = this.settings.get('vaeTiling');
        if (!hasExtra('--vae-tiling') && vaeTiling) {
            args.push('--vae-tiling');
            const tileSize = parseInt(this.settings.get('vaeTileSize'), 10) || 256;
            if (!hasExtra('--vae-tile-size') && tileSize > 0) {
                args.push('--vae-tile-size', tileSize + 'x' + tileSize);
            }
            const overlap = parseFloat(this.settings.get('vaeTileOverlap'));
            if (!hasExtra('--vae-tile-overlap') && !isNaN(overlap) && overlap >= 0 && overlap <= 0.5) {
                args.push('--vae-tile-overlap', String(overlap));
            }
            if (!hasExtra('--temporal-tiling') && this.settings.get('temporalTiling')) {
                args.push('--temporal-tiling');
            }
        }

        const offloadToCpu = this.settings.get('offloadToCpu');
        if (!hasExtra('--offload-to-cpu') && offloadToCpu) {
            args.push('--offload-to-cpu');
        }

        const paramsBackend = this.settings.get('paramsBackend');
        if (!hasExtra('--params-backend') && paramsBackend && paramsBackend !== 'auto') {
            args.push('--params-backend', paramsBackend);
        }

        const maxVram = String(this.settings.get('maxVram') || '').trim();
        if (!hasExtra('--max-vram') && maxVram) {
            args.push('--max-vram', maxVram);
        }

        const cacheMode = this.settings.get('cacheMode');
        if (!hasExtra('--cache-mode') && cacheMode && cacheMode !== 'disabled') {
            args.push('--cache-mode', cacheMode);
        }

        const cacheOption = String(this.settings.get('cacheOption') || '').trim();
        if (!hasExtra('--cache-option') && cacheOption) {
            args.push('--cache-option', cacheOption);
        }

        const autoFit = this.settings.get('autoFit');
        if (!hasExtra('--auto-fit') && autoFit && autoFit !== 'on') {
            args.push('--auto-fit', autoFit);
        }

        const disablePrefetch = this.settings.get('disablePrefetch');
        if (!hasExtra('--disable-prefetch') && disablePrefetch) {
            args.push('--disable-prefetch');
        }

        const disableSegmentedCompute = this.settings.get('disableSegmentedCompute');
        if (!hasExtra('--disable-segmented-compute') && disableSegmentedCompute) {
            args.push('--disable-segmented-compute');
        }

        const sageAttn = this.settings.get('sageAttn');
        if (!hasExtra('--sage-attn') && sageAttn) {
            args.push('--sage-attn');
        }

        const threads = parseInt(this.settings.get('threads'), 10);
        if (!hasExtra('--threads') && !hasExtra('-t') && !isNaN(threads) && threads > 0) {
            args.push('--threads', String(threads));
        }

        args.push('--listen-ip', host);
        args.push('--listen-port', String(port));

        if (extraTokens.length > 0) {
            args.push(...extraTokens);
        }
        return args;
    }

    getServerUrl() {
        const host = this.settings.get('listenHost') || '127.0.0.1';
        const port = this.settings.get('listenPort') || 1234;
        return `http://${host}:${port}`;
    }

    /**
     * Start the sd-server process. Resolves once process spawned; readiness is
     * polled separately by the API client.
     */
    async start() {
        if (this.process) {
            return { alreadyRunning: true, url: this.runningUrl };
        }
        const backendDir = this.settings.get('backendDir');
        let exes = [];
        if (backendDir) {
            exes = findServerExecutable(backendDir);
        }
        if (exes.length === 0) {
            throw new Error(
                'No sd-server found. Install a stable-diffusion.cpp release or import a zip first.'
            );
        }
        const serverPath = exes[0];
        this.serverPath = serverPath;
        const modelPath = this.settings.get('modelPath');
        const diffusionModel = this.settings.get('diffusionModelPath');
        if (!modelPath && !diffusionModel) {
            throw new Error(
                'No diffusion model selected. Open Settings (gear icon) \u2192 Models, pick a model from the "Diffusion model" list, then start the server again.'
            );
        }
        const args = this.buildLaunchArgs();
        const url = this.getServerUrl();

        const logFile = path.join(path.dirname(serverPath), 'sd-server.log');
        try {
            fs.appendFileSync(logFile, `\n\n=== Launch ${new Date().toISOString()} ===\n${serverPath} ${args.join(' ')}\n`);
        } catch {}

        this.log('info', `Launching: ${serverPath} ${args.join(' ')}`);
        this.status = 'starting';
        this.emit({ type: 'state', ...this.getState() });

        return new Promise((resolve, reject) => {
            let settled = false;
            let lastErrorMsg = '';

            const proc = spawn(serverPath, args, {
                cwd: path.dirname(serverPath),
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            this.process = proc;
            this.runningUrl = url;

            const handleOutput = (d) => {
                const line = d.toString().trimEnd();
                try {
                    fs.appendFileSync(logFile, line + '\n');
                } catch {}
                this.log('server', line);
                if (line.includes('[E] ') || line.toLowerCase().includes('error:') || line.toLowerCase().includes('failed to')) {
                    const match = line.match(/\[E\]\s*(.*)/);
                    lastErrorMsg = match ? match[1] : line;
                }
            };

            proc.stdout.on('data', handleOutput);
            proc.stderr.on('data', handleOutput);

            proc.on('error', (err) => {
                try {
                    fs.appendFileSync(logFile, `[PROC ERROR] ${err.message}\n`);
                } catch {}
                this.log('error', `Failed to start server: ${err.message}`);
                this.status = 'error';
                this.process = null;
                this.runningUrl = null;
                this.emit({ type: 'state', ...this.getState() });
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });

            proc.on('exit', (code, signal) => {
                try {
                    fs.appendFileSync(logFile, `[EXIT] code=${code}, signal=${signal}\n`);
                } catch {}
                this.log('info', `Server process exited (code=${code}, signal=${signal})`);
                this.process = null;
                this.runningUrl = null;
                if (this.status !== 'stopped') {
                    this.status = code === 0 ? 'stopped' : 'error';
                }
                this.emit({ type: 'state', ...this.getState() });
                if (!settled) {
                    settled = true;
                    const errText = lastErrorMsg || `Server exited with code ${code}`;
                    reject(new Error(errText));
                }
            });

            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ url });
                }
            }, 800);
        });
    }

    /**
     * Stop the running server.
     */
    async stop() {
        if (!this.process) {
            return;
        }
        this.log('info', 'Stopping server...');
        const proc = this.process;
        this.process = null;
        this.status = 'stopped';
        this.runningUrl = null;
        this.emit({ type: 'state', ...this.getState() });
        try {
            proc.kill();
        } catch {}
    }

    async dispose() {
        if (this.process) {
            try {
                this.process.kill();
            } catch {}
            this.process = null;
        }
    }
}

module.exports = { BackendManager, findServerExecutable, extractZip, downloadFile, validateBackendDir };
