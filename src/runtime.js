'use strict';

/**
 * Runtime & GPU detection for SD.cpp Studio.
 *
 * Detects:
 *  - the current platform / architecture
 *  - the GPUs present on the machine (vendor, name, VRAM)
 *  - which stable-diffusion.cpp build variant is in use (cuda / vulkan / rocm / metal / cpu)
 *  - which ggml devices sd-server can actually see (from --list-devices)
 *  - native runtime DLLs / shared libraries the backend is missing
 *
 * And can download & install the missing pieces (currently the CUDA 12 runtime
 * DLLs on Windows) so GPU generation works out of the box.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const { downloadFile, extractZip, findServerExecutable } = require('./backend');

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

function getPlatformInfo() {
    const info = {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
    };
    if (process.platform === 'win32') {
        info.windowsVersion = os.release();
    }
    return info;
}

// ---------------------------------------------------------------------------
// GPU detection
// ---------------------------------------------------------------------------

const VENDOR_IDS = {
    '10DE': 'nvidia',
    '1002': 'amd',
    '1022': 'amd',
    '8086': 'intel',
    '1414': 'microsoft',
};

const VENDOR_NAMES = {
    nvidia: 'NVIDIA',
    amd: 'AMD',
    intel: 'Intel',
    microsoft: 'Microsoft',
    unknown: 'Unknown',
};

const VIRTUAL_GPU_PATTERNS = [/virtual/i, /basic display/i, /remote/i, /parsec/i, /mirror/i, /monitor/i];

function isVirtualGpuName(name) {
    return VIRTUAL_GPU_PATTERNS.some((re) => re.test(name || ''));
}

function detectGpu() {
    if (process.platform === 'win32') return detectGpuWindows();
    if (process.platform === 'linux') return detectGpuLinux();
    if (process.platform === 'darwin') return detectGpuMac();
    return [];
}

function detectGpuWindows() {
    let gpus = [];
    try {
        const windir = process.env.windir || 'C:\\Windows';
        const ps = path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const script =
            'Get-CimInstance Win32_VideoController | ForEach-Object { "{0}|{1}|{2}" -f $_.Name, $_.PNPDeviceID, $_.AdapterRAM }';
        const out = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            timeout: 20000,
            windowsHide: true,
        });
        gpus = out
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('|');
                const name = (parts[0] || '').trim();
                const pnp = parts[1] || '';
                const ramRaw = parseInt(parts[2], 10) || 0;
                let vendor = 'unknown';
                const m = /VEN_([0-9A-Fa-f]{4})/.exec(pnp);
                if (m) vendor = VENDOR_IDS[(m[1] || '').toUpperCase()] || 'unknown';
                return {
                    name,
                    vendor,
                    vendorName: VENDOR_NAMES[vendor] || vendor,
                    vramMB: Math.round(ramRaw / 1048576),
                    virtual: isVirtualGpuName(name),
                };
            })
            .filter((g) => g.name);
    } catch {}
    // Win32_VideoController caps AdapterRAM at ~4GB; use nvidia-smi for accurate VRAM.
    try {
        const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
            encoding: 'utf8',
            timeout: 10000,
        });
        const smiGpus = out
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                const [name, mem] = line.split(',');
                return {
                    name: (name || '').trim(),
                    vendor: 'nvidia',
                    vendorName: 'NVIDIA',
                    vramMB: parseInt(mem, 10) * 1024 || 0,
                };
            });
        let smiIdx = 0;
        for (const g of gpus) {
            if (g.vendor !== 'nvidia') continue;
            if (smiIdx >= smiGpus.length) break;
            g.name = smiGpus[smiIdx].name || g.name;
            g.vramMB = smiGpus[smiIdx].vramMB;
            smiIdx++;
        }
        while (smiIdx < smiGpus.length) {
            gpus.push({ ...smiGpus[smiIdx], virtual: false });
            smiIdx++;
        }
    } catch {}
    return gpus;
}

function detectGpuLinux() {
    const gpus = [];
    try {
        const out = execFileSync('lspci', ['-nn'], { encoding: 'utf8', timeout: 10000 });
        for (const line of out.split(/\r?\n/)) {
            if (!/(vga|3d|display)/i.test(line)) continue;
            let vendor = 'unknown';
            if (/\[10DE:/.test(line)) vendor = 'nvidia';
            else if (/\[1002:/.test(line)) vendor = 'amd';
            else if (/\[8086:/.test(line)) vendor = 'intel';
            gpus.push({
                name: line.replace(/^[^:]+:\s*/, '').trim(),
                vendor,
                vendorName: VENDOR_NAMES[vendor],
                vramMB: 0,
                virtual: false,
            });
        }
    } catch {}
    try {
        const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
            encoding: 'utf8',
            timeout: 10000,
        });
        out
            .split(/\r?\n/)
            .filter(Boolean)
            .forEach((line, idx) => {
                const [name, mem] = line.split(',');
                if (gpus[idx]) {
                    gpus[idx].name = (name || '').trim();
                    gpus[idx].vramMB = parseInt(mem, 10) * 1024 || 0;
                    gpus[idx].vendor = 'nvidia';
                    gpus[idx].vendorName = 'NVIDIA';
                } else {
                    gpus.push({
                        name: (name || '').trim(),
                        vendor: 'nvidia',
                        vendorName: 'NVIDIA',
                        vramMB: parseInt(mem, 10) * 1024 || 0,
                        virtual: false,
                    });
                }
            });
    } catch {}
    return gpus.filter((g) => g.name);
}

function detectGpuMac() {
    const gpus = [];
    try {
        const out = execFileSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8', timeout: 20000 });
        for (const line of out.split(/\r?\n/)) {
            const m = /Chipset Model:\s*(.+)/i.exec(line);
            if (!m) continue;
            const name = m[1].trim();
            let vendor = 'unknown';
            if (/amd|radeon/i.test(name)) vendor = 'amd';
            else if (/intel/i.test(name)) vendor = 'intel';
            else if (/apple/i.test(name)) vendor = 'apple';
            gpus.push({ name, vendor, vendorName: VENDOR_NAMES[vendor] || 'Apple', vramMB: 0, virtual: false });
        }
    } catch {}
    return gpus;
}

// ---------------------------------------------------------------------------
// Backend variant detection (which stable-diffusion.cpp build is in use)
// ---------------------------------------------------------------------------

function inferVariant(backendDir) {
    if (!backendDir || !fs.existsSync(backendDir)) {
        return { variant: 'none', label: 'No backend installed' };
    }
    let files;
    try {
        files = fs.readdirSync(backendDir);
    } catch {
        return { variant: 'none', label: 'No backend installed' };
    }
    const has = (patterns) => files.some((f) => patterns.some((p) => p.test(f)));

    if (has([/ggml-cuda\.(dll|so|dylib)$/i])) {
        const major = detectCudaMajor(backendDir, files);
        return { variant: 'cuda', label: `CUDA build${major ? ` (CUDA ${major})` : ''}` };
    }
    if (has([/ggml-vulkan\.(dll|so|dylib)$/i])) {
        return { variant: 'vulkan', label: 'Vulkan build' };
    }
    if (has([/ggml-rocm\.(dll|so|dylib)$/i, /ggml-hip/i, /libhipblas/i])) {
        return { variant: 'rocm', label: 'ROCm build' };
    }
    if (has([/ggml-metal\.(dll|so|dylib)$/i, /ggml-metal\.metal$/i])) {
        return { variant: 'metal', label: 'Metal build (macOS)' };
    }
    return { variant: 'cpu', label: 'CPU-only build' };
}

function detectCudaMajor(backendDir, files) {
    for (const f of files) {
        const m = /cuda(\d+)/i.exec(f);
        if (m) return m[1];
    }
    try {
        for (const bin of ['sd-server.exe', 'stable-diffusion.dll']) {
            const p = path.join(backendDir, bin);
            if (!fs.existsSync(p)) continue;
            for (const imp of readPeImports(p)) {
                const m = /^(?:cudart|cublas)cuda?(\d+)/.exec(imp);
                if (m) return m[1];
            }
        }
    } catch {}
    return null;
}

// ---------------------------------------------------------------------------
// Devices visible to sd-server (--list-devices)
// ---------------------------------------------------------------------------

function listDevices(serverPath) {
    return new Promise((resolve) => {
        if (!serverPath || !fs.existsSync(serverPath)) {
            resolve([]);
            return;
        }
        let out = '';
        let err = '';
        let proc;
        try {
            proc = spawn(serverPath, ['--list-devices'], {
                cwd: path.dirname(serverPath),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            resolve([]);
            return;
        }
        const timer = setTimeout(() => {
            try {
                proc.kill();
            } catch {}
        }, 20000);
        proc.stdout.on('data', (d) => (out += d.toString()));
        proc.stderr.on('data', (d) => (err += d.toString()));
        proc.on('error', () => {
            clearTimeout(timer);
            resolve([]);
        });
        proc.on('close', () => {
            clearTimeout(timer);
            const devices = [];
            for (const raw of (out + '\n' + err).split(/\r?\n/)) {
                const line = raw.trim();
                if (!line) continue;
                if (/^load_backend:/i.test(line)) continue;
                if (/^ggml_/i.test(line)) continue;
                if (/^Device \d+:/i.test(line)) continue;
                if (/usage:/i.test(line) || /options/i.test(line) || /version unknown/i.test(line)) continue;
                // Documented --list-devices format is "name<TAB>description" per line.
                const tab = line.indexOf('\t');
                if (tab <= 0) continue;
                const name = line.slice(0, tab).trim();
                const description = line.slice(tab + 1).trim();
                if (name) devices.push({ name, description });
            }
            resolve(devices);
        });
    });
}

// ---------------------------------------------------------------------------
// Missing dependency detection
// ---------------------------------------------------------------------------

const KNOWN_SYSTEM_PREFIXES = ['api-ms-win-', 'ext-ms-win-'];

function readPeImports(filePath) {
    const imports = [];
    let bytes;
    try {
        bytes = fs.readFileSync(filePath);
    } catch {
        return imports;
    }
    if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) return imports; // not a PE
    const peOff = bytes.readUInt32LE(0x3c);
    if (peOff + 24 > bytes.length) return imports;
    const optMagic = bytes.readUInt16LE(peOff + 24);
    const optSize = bytes.readUInt16LE(peOff + 20);
    const opt = peOff + 24;
    let importRVA = 0;
    if (optMagic === 0x20b) {
        importRVA = bytes.readUInt32LE(opt + 120);
    } else if (optMagic === 0x10b) {
        importRVA = bytes.readUInt32LE(opt + 104);
    } else {
        return imports;
    }
    const sectionCount = bytes.readUInt16LE(peOff + 6);
    const sections = [];
    const secStart = opt + optSize;
    for (let i = 0; i < sectionCount; i++) {
        const so = secStart + i * 40;
        if (so + 24 > bytes.length) break;
        sections.push({
            rva: bytes.readUInt32LE(so + 12),
            vsize: bytes.readUInt32LE(so + 8),
            raw: bytes.readUInt32LE(so + 20),
        });
    }
    const rvaToFile = (rva) => {
        for (const s of sections) {
            if (rva >= s.rva && rva < s.rva + Math.max(s.vsize, 1)) {
                return s.raw + (rva - s.rva);
            }
        }
        return -1;
    };
    if (!importRVA) return imports;
    let desc = rvaToFile(importRVA);
    if (desc < 0) return imports;
    let guard = 0;
    while (desc + 20 <= bytes.length && guard++ < 4096) {
        const nameRVA = bytes.readUInt32LE(desc + 12);
        if (nameRVA === 0) break;
        const no = rvaToFile(nameRVA);
        if (no < 0 || no >= bytes.length) break;
        let name = '';
        for (let j = no; j < bytes.length; j++) {
            if (bytes[j] === 0) break;
            name += String.fromCharCode(bytes[j]);
        }
        if (name) imports.push(name.toLowerCase());
        desc += 20;
    }
    return imports;
}

function isPresentOnSystem(importName) {
    const name = importName.toLowerCase();
    if (KNOWN_SYSTEM_PREFIXES.some((p) => name.startsWith(p))) return true;
    if (process.platform !== 'win32') return true;
    try {
        const system32 = path.join(process.env.windir || 'C:\\Windows', 'System32');
        return fs.existsSync(path.join(system32, name));
    } catch {
        return true;
    }
}

function categorizeDll(name) {
    const lower = name.toLowerCase();
    if (
        /^cudart64_\d+\.dll$/.test(lower) ||
        /^cublas64_\d+\.dll$/.test(lower) ||
        /^cublaslt64_\d+\.dll$/.test(lower)
    ) {
        return 'cuda-runtime';
    }
    if (
        /^(cufft|cufftw|curand|cusolver|cusolvermg|cusparse|nvrtc|nvrtc-builtins|nvjpeg|nppi[a-z]*)64_\d+\.dll$/i.test(
            lower
        )
    ) {
        return 'cuda-runtime';
    }
    if (/^vulkan-1\.dll$/.test(lower) || /^vfx-1\.dll$/.test(lower)) {
        return 'vulkan-runtime';
    }
    if (/^(msvcp|vcruntime|msvcrt)[0-9_]*\.dll$/i.test(lower)) {
        return 'vc-redist';
    }
    return 'other';
}

const DEP_GROUP_META = {
    'cuda-runtime': {
        id: 'cuda-runtime',
        label: 'NVIDIA CUDA runtime',
        description:
            'Runtime DLLs needed by CUDA builds of stable-diffusion.cpp. The app can download them from NVIDIA\'s official redist archive.',
        fixable: true,
        download: true,
    },
    'vulkan-runtime': {
        id: 'vulkan-runtime',
        label: 'Vulkan runtime',
        description:
            'The Vulkan loader (vulkan-1.dll). Normally ships with the graphics driver on Windows 10/11. Update your GPU driver to install it.',
        fixable: false,
        download: false,
    },
    'vc-redist': {
        id: 'vc-redist',
        label: 'Microsoft Visual C++ Redistributable',
        description:
            'Required by most stable-diffusion.cpp builds. Install the Microsoft Visual C++ 2015-2022 Redistributable (x64).',
        fixable: false,
        download: false,
    },
    'rocm-runtime': {
        id: 'rocm-runtime',
        label: 'ROCm runtime',
        description: 'ROCm libraries required by ROCm builds of stable-diffusion.cpp on Linux.',
        fixable: false,
        download: false,
    },
    other: {
        id: 'other',
        label: 'Other missing libraries',
        description: 'Libraries referenced by the backend but not found on this system.',
        fixable: false,
        download: false,
    },
};

function checkDependencies(backendDir) {
    if (process.platform === 'win32') return checkDependenciesWindows(backendDir);
    return checkDependenciesPosix(backendDir);
}

function scanMissingImportsWindows(backendDir) {
    if (!backendDir || !fs.existsSync(backendDir)) return [];
    let files;
    try {
        files = fs.readdirSync(backendDir);
    } catch {
        return [];
    }
    const binaries = files
        .filter((f) => /\.(exe|dll)$/i.test(f))
        .map((f) => path.join(backendDir, f));
    const missing = new Map();
    for (const bin of binaries) {
        for (const imp of readPeImports(bin)) {
            const fileName = path.basename(imp);
            if (fs.existsSync(path.join(backendDir, fileName))) continue;
            if (isPresentOnSystem(fileName)) continue;
            if (!missing.has(fileName)) missing.set(fileName, new Set());
            missing.get(fileName).add(path.basename(bin));
        }
    }
    const list = [];
    for (const [name, refs] of missing) {
        list.push({ name, referencedBy: Array.from(refs) });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
}

function checkDependenciesWindows(backendDir) {
    const missing = scanMissingImportsWindows(backendDir);
    const groups = {};
    for (const item of missing) {
        const category = categorizeDll(item.name);
        if (!groups[category]) groups[category] = { ...DEP_GROUP_META[category], missing: [] };
        groups[category].missing.push(item);
    }
    const deps = Object.values(groups).map((g) => {
        g.missingFiles = g.missing.map((m) => m.name);
        return g;
    });
    const allMissing = deps.flatMap((d) => d.missingFiles);
    return { ok: allMissing.length === 0, deps, missingFiles: allMissing };
}

function checkDependenciesPosix(backendDir) {
    if (!backendDir || !fs.existsSync(backendDir)) return { ok: true, deps: [], missingFiles: [] };
    const exes = findServerExecutable(backendDir);
    if (!exes.length) return { ok: true, deps: [], missingFiles: [] };
    const tool = process.platform === 'darwin' ? 'otool' : 'ldd';
    let out = '';
    try {
        out = execFileSync(tool, process.platform === 'darwin' ? ['-L', exes[0]] : [exes[0]], {
            encoding: 'utf8',
            timeout: 15000,
        });
    } catch (e) {
        out = typeof e.stdout === 'string' ? e.stdout : '';
    }
    const missing = [];
    for (const line of out.split(/\r?\n/)) {
        if (/not found/i.test(line)) {
            const nm = /([^\s]+\.so(?:\.\d+)*)/.exec(line);
            if (nm) missing.push({ name: nm[1], referencedBy: [path.basename(exes[0])] });
            continue;
        }
        const m = /([^\s:]+\.(?:so(?:\.\d+)*|dylib))/.exec(line.trim());
        if (!m) continue;
        const lib = m[1];
        const base = path.basename(lib);
        if (fs.existsSync(lib)) continue;
        if (fs.existsSync(path.join(backendDir, base))) continue;
        if (/(^\/usr|^\/lib|ld-linux|libc\.so|libsystem_)/.test(lib)) continue;
        missing.push({ name: base, referencedBy: [path.basename(exes[0])] });
    }
    const groups = {};
    for (const item of missing) {
        let category = 'other';
        if (/librocblas|hipblas|rocblas|libamd|libcblas|libhip/.test(item.name)) category = 'rocm-runtime';
        if (!groups[category]) groups[category] = { ...DEP_GROUP_META[category], missing: [] };
        groups[category].missing.push(item);
    }
    const deps = Object.values(groups).map((g) => {
        g.missingFiles = g.missing.map((m) => m.name);
        return g;
    });
    const allMissing = deps.flatMap((d) => d.missingFiles);
    return { ok: allMissing.length === 0, deps, missingFiles: allMissing };
}

// ---------------------------------------------------------------------------
// Auto-download / fix missing dependencies
// ---------------------------------------------------------------------------

// Official NVIDIA CUDA redist archives (major version -> known-good 12.x/11.x).
// URLs are served by developer.download.nvidia.com/compute/cuda/redist/...
const CUDA_REDIST = {
    12: {
        cudart:
            'https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.9.79-archive.zip',
        cublas:
            'https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-12.9.2.10-archive.zip',
    },
    11: {
        cudart:
            'https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-11.8.89-archive.zip',
        cublas:
            'https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-11.8.3.2-archive.zip',
    },
};

function cudaMajorFromFiles(missingFiles) {
    for (const f of missingFiles) {
        const m = /(?:cudart|cublas)(?:cuda)?(\d+)/i.exec(f);
        if (m) return parseInt(m[1], 10);
    }
    return 12;
}

async function findFileInDirRecursive(dir, filename, depth) {
    if (depth > 4) return null;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            const hit = await findFileInDirRecursive(full, filename, depth + 1);
            if (hit) return hit;
        } else if (e.name.toLowerCase() === filename.toLowerCase()) {
            return full;
        }
    }
    return null;
}

/**
 * Fix a dependency group by downloading the needed runtime files next to the
 * backend executable. Currently supports the CUDA runtime on Windows.
 */
async function fixDependency(backendDir, groupId, onProgress) {
    if (!backendDir || !fs.existsSync(backendDir)) {
        throw new Error('No backend folder to fix. Link or install a backend first.');
    }
    if (process.platform !== 'win32' || groupId !== 'cuda-runtime') {
        throw new Error(`Automatic fixes are not available for "${groupId}" on this platform yet.`);
    }
    const before = checkDependenciesWindows(backendDir);
    const group = (before.deps || []).find((d) => d.id === groupId);
    const missingFiles = (group && group.missingFiles) || [];
    if (missingFiles.length === 0) {
        return { ok: true, installed: [], stillMissing: [] };
    }

    const major = cudaMajorFromFiles(missingFiles);
    const sources = CUDA_REDIST[major] || CUDA_REDIST[12];
    if (!sources) throw new Error(`No download source for CUDA ${major} runtime.`);

    const workDir = path.join(os.tmpdir(), `sdcpp-cuda-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    const report = { installed: [], failed: [] };

    try {
        const archives = [];
        const cudaNeeds = missingFiles.some((f) => /^cudart64/.test(f));
        const cublasNeeds = missingFiles.some((f) => /^cublas/.test(f));
        if (cudaNeeds) archives.push({ url: sources.cudart, key: 'cudart' });
        if (cublasNeeds) archives.push({ url: sources.cublas, key: 'cublas' });

        for (const arch of archives) {
            if (onProgress) {
                onProgress({ phase: arch.key, message: `Downloading ${arch.key} runtime...`, received: 0, total: 0 });
            }
            const zipPath = path.join(workDir, `${arch.key}.zip`);
            await downloadFile(arch.url, zipPath, (p) => {
                if (onProgress) onProgress({ phase: arch.key, message: `Downloading ${arch.key} runtime...`, ...p });
            });
            const extractedDir = path.join(workDir, arch.key);
            extractZip(zipPath, extractedDir);
            fs.rmSync(zipPath, { force: true });
        }

        // Install the whole runtime family for this CUDA major (covers DLLs that
        // cuBLAS/cudart load at runtime via LoadLibrary, e.g. cublasLt64_12.dll).
        const wanted = missingFiles.concat(
            missingFiles
                .filter((f) => /^cublas64_\d+\.dll$/.test(f))
                .map((f) => `cublasLt64_${/cublas64_(\d+)\.dll$/.exec(f)[1]}.dll`)
        );
        const uniqueWanted = Array.from(new Set(wanted));
        for (const dllName of uniqueWanted) {
            const src = await findFileInDirRecursive(workDir, dllName, 0);
            if (src) {
                fs.copyFileSync(src, path.join(backendDir, dllName));
                report.installed.push(dllName);
            } else {
                report.failed.push(dllName);
            }
        }
    } finally {
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        } catch {}
    }

    const after = checkDependenciesWindows(backendDir);
    return {
        ok: after.ok,
        installed: report.installed,
        failed: report.failed,
        stillMissing: after.missingFiles,
    };
}

// ---------------------------------------------------------------------------
// Convenience: full runtime snapshot
// ---------------------------------------------------------------------------

async function getRuntimeInfo(backendDir) {
    let serverPath = null;
    if (backendDir && fs.existsSync(backendDir)) {
        const exes = findServerExecutable(backendDir);
        serverPath = exes[0] || null;
    }
    const variant = inferVariant(backendDir || '');
    const devices = serverPath ? await listDevices(serverPath) : [];
    const deps = checkDependencies(backendDir || '');
    const gpus = detectGpu();

    // Only-CPU warning: a real GPU exists, variant expects GPU, but no GPU device visible.
    const realGpus = gpus.filter((g) => !g.virtual && g.vendor !== 'unknown');
    const hasGpuDevice = devices.some((d) => !/^cpu$/i.test(d.name) && !/cpu$/i.test(d.name));
    const gpuSilent = realGpus.length > 0 && variant.variant !== 'cpu' && variant.variant !== 'none' && !hasGpuDevice;

    return {
        platform: getPlatformInfo(),
        gpus,
        variant,
        devices,
        deps,
        serverPath,
        gpuSilent,
        warnings: {
            gpuSilent,
        },
    };
}

module.exports = {
    getPlatformInfo,
    detectGpu,
    inferVariant,
    listDevices,
    readPeImports,
    checkDependencies,
    fixDependency,
    getRuntimeInfo,
};
