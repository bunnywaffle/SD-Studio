'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Canonical model folder layout
const SUBDIRS = {
    models: 'models',
    loras: 'loras',
    vae: 'vae',
    textEncoders: 'text_encoders',
};

const EXTENSIONS = {
    models: ['safetensors', 'gguf', 'ckpt', 'pth', 'pt', 'bin'],
    loras: ['safetensors', 'gguf', 'bin', 'pt', 'sft'],
    vae: ['safetensors', 'pt', 'ckpt', 'pth', 'bin', 'gguf'],
    textEncoders: ['safetensors', 'gguf', 'bin', 'pt', 'ckpt', 'pth', 'json'],
};

function createStructure(dir) {
    const created = [];
    for (const sub of Object.values(SUBDIRS)) {
        const full = path.join(dir, sub);
        fs.mkdirSync(full, { recursive: true });
        created.push(full);
    }
    return created;
}

const VISION_ENCODER_RE = /mmproj|vision|vlm|vl-|vl\./i;

// Weight formats the upstream server loads via the UNIFIED loader (`-m`):
// Pytorch checkpoints + safetensors. GGUF carries architecture metadata and is
// passed via --diffusion-model (the proven path for FLUX-family gguf files).
const UNIFIED_MODEL_EXTS = ['safetensors', 'ckpt', 'pth', 'pt'];

function modelLaunchMode(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return UNIFIED_MODEL_EXTS.includes(ext) ? 'unified' : 'diffusion';
}

// Subfolder + accepted extensions per import-by-link type.
const LINK_TYPES = {
    diffusion: { sub: 'models', exts: EXTENSIONS.models, label: 'Diffusion model' },
    lora: { sub: 'loras', exts: EXTENSIONS.loras, label: 'LoRA' },
    vae: { sub: 'vae', exts: EXTENSIONS.vae, label: 'VAE' },
    textEncoder: { sub: 'text_encoders', exts: EXTENSIONS.textEncoders, label: 'Text encoder' },
    visionEncoder: { sub: 'text_encoders', exts: EXTENSIONS.textEncoders, label: 'Vision encoder' },
    tokenizer: { sub: 'text_encoders', exts: ['json'], label: 'Tokenizer' },
};

function listFiles(dir, exts, modeFn) {
    if (!dir || !fs.existsSync(dir)) return [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const out = [];
        for (const e of entries) {
            if (!e.isFile() && !e.isSymbolicLink()) continue;
            const ext = path.extname(e.name).slice(1).toLowerCase();
            if (exts.includes(ext)) {
                const full = path.join(dir, e.name);
                let size = 0;
                try {
                    size = fs.statSync(full).size;
                } catch {}
                const entry = { name: e.name, path: full, size, empty: size === 0 };
                if (modeFn) entry.mode = modeFn(full);
                out.push(entry);
            }
        }
        out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        return out;
    } catch {
        return [];
    }
}

/**
 * Link a model file that lives anywhere on disk into the models folder.
 * Tries a symlink first (works cross-platform; Windows needs Developer Mode
 * or admin), then falls back to a hard link (same volume, no privileges).
 */
function linkModelFile(filePath, type, modelsDir) {
    const cfg = LINK_TYPES[type];
    if (!cfg) return { ok: false, error: `Unknown model type: ${type}` };
    if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'Selected file does not exist.' };
    }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!cfg.exts.includes(ext)) {
        return {
            ok: false,
            error: `${path.basename(filePath)} is not a supported ${cfg.label} file (${cfg.exts.join(', ')}).`,
        };
    }
    if (!modelsDir) {
        return { ok: false, error: 'No model folder configured. Set one in Settings → Models first.' };
    }
    const dir = path.join(modelsDir, cfg.sub);
    fs.mkdirSync(dir, { recursive: true });

    const base = path.basename(filePath);
    const stem = path.basename(filePath, path.extname(filePath));
    let linkPath = path.join(dir, base);
    for (let i = 2; fs.existsSync(linkPath); i++) {
        linkPath = path.join(dir, `${stem}_${i}${path.extname(base)}`);
    }

    let linked = false;
    try {
        fs.linkSync(filePath, linkPath);
        linked = true;
    } catch {}
    if (!linked) {
        try {
            fs.symlinkSync(filePath, linkPath, 'file');
            linked = true;
        } catch (e) {
            return {
                ok: false,
                error: `Could not link ${base}: ${e.message}. On Windows, enable Developer Mode or pick a file on the same drive as the models folder.`,
            };
        }
    }
    return { ok: true, type, sub: cfg.sub, linkPath, name: path.basename(linkPath) };
}

function deleteModelFile(filePath, modelsDir) {
    if (!filePath || !modelsDir) return { ok: false, error: 'Missing file or models folder.' };
    const resolvedFile = path.resolve(filePath);
    const resolvedDir = path.resolve(modelsDir);
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        return { ok: false, error: 'Refusing to delete file outside the models folder.' };
    }
    let stat;
    try {
        stat = fs.lstatSync(resolvedFile);
    } catch {
        return { ok: false, error: 'File not found.' };
    }
    // Only allow files/symlinks, not directories
    if (!stat.isFile() && !stat.isSymbolicLink()) {
        return { ok: false, error: 'Only files can be deleted.' };
    }
    try {
        fs.unlinkSync(resolvedFile);
    } catch (e) {
        return { ok: false, error: e.message };
    }
    return { ok: true, deleted: resolvedFile };
}

function suggestDefaultDir() {
    // The default model folder lives inside the self-contained app data dir,
    // so everything the app stores stays under one root.
    return path.join(app.getPath('userData'), 'models');
}

function scan(dir) {
    const subDirs = {};
    for (const [key, sub] of Object.entries(SUBDIRS)) {
        subDirs[key] = dir ? path.join(dir, sub) : '';
    }
    const exists = !!dir && fs.existsSync(dir);
    const structureComplete = exists && Object.values(subDirs).every((s) => fs.existsSync(s));
    const result = { models: [], loras: [], vae: [], textEncoders: [], visionEncoders: [] };
    for (const key of Object.keys(SUBDIRS)) {
        result[key] = listFiles(subDirs[key], EXTENSIONS[key], key === 'models' ? modelLaunchMode : undefined);
    }
    // Vision encoders (mmproj / VLM CLIP files) live in text_encoders/ too;
    // fall back to listing all text encoders when none match so the picker is still usable.
    const visionFiles = result.textEncoders.filter((f) => VISION_ENCODER_RE.test(f.name));
    result.visionEncoders = visionFiles.length > 0 ? visionFiles : result.textEncoders;
    result.tokenizers = result.textEncoders.filter((f) => f.name.toLowerCase().endsWith('.json') || f.name.toLowerCase().includes('tokenizer'));
    return {
        dir: dir || '',
        exists,
        structureComplete,
        subDirs,
        suggestedDir: suggestDefaultDir(),
        ...result,
    };
}

module.exports = { SUBDIRS, EXTENSIONS, createStructure, listFiles, scan, linkModelFile, deleteModelFile, modelLaunchMode, suggestDefaultDir };
