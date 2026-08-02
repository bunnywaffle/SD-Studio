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

    /**
     * Build the CLI args to launch sd-server from current settings.
     */
    buildLaunchArgs() {
        const args = [];
        const modelPath = this.settings.get('modelPath');
        const diffusionModel = this.settings.get('diffusionModelPath');
        const vaePath = this.settings.get('vaePath');
        const tePath = this.settings.get('textEncoderPath');
        const loraDir = this.settings.get('loraDir');
        const host = this.settings.get('listenHost') || '127.0.0.1';
        const port = this.settings.get('listenPort') || 1234;

        if (modelPath) {
            args.push('-m', modelPath);
        }
        if (diffusionModel) {
            args.push('--diffusion-model', diffusionModel);
        }
        if (vaePath) {
            args.push('--vae', vaePath);
        }
        if (tePath) {
            args.push('--llm', tePath);
        }
        if (loraDir) {
            args.push('--lora-model-dir', loraDir);
        }
        args.push('--listen-ip', host);
        args.push('--listen-port', String(port));

        const extra = (this.settings.get('extraArgs') || '').trim();
        if (extra) {
            args.push(...extra.split(/\s+/).filter(Boolean));
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

        this.log('info', `Launching: ${serverPath} ${args.join(' ')}`);
        this.status = 'starting';
        this.emit({ type: 'state', ...this.getState() });

        return new Promise((resolve, reject) => {
            const proc = spawn(serverPath, args, {
                cwd: path.dirname(serverPath),
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            this.process = proc;
            this.runningUrl = url;

            proc.stdout.on('data', (d) => this.log('server', d.toString().trimEnd()));
            proc.stderr.on('data', (d) => this.log('server', d.toString().trimEnd()));

            proc.on('error', (err) => {
                this.log('error', `Failed to start server: ${err.message}`);
                this.status = 'error';
                this.process = null;
                this.runningUrl = null;
                this.emit({ type: 'state', ...this.getState() });
                reject(err);
            });

            proc.on('exit', (code, signal) => {
                this.log('info', `Server process exited (code=${code}, signal=${signal})`);
                this.process = null;
                this.runningUrl = null;
                if (this.status !== 'stopped') {
                    this.status = code === 0 ? 'stopped' : 'error';
                }
                this.emit({ type: 'state', ...this.getState() });
            });

            resolve({ url });
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
