'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let defaultUserData = null;

function pointerFile() {
    return path.join(defaultUserData, 'data-dir.json');
}

/**
 * Apply the custom app-data folder (if the user picked one) BEFORE any module
 * starts reading app.getPath('userData'). The pointer lives in the default
 * userData location so it is always found regardless of the current data dir.
 */
function applyDataDir() {
    defaultUserData = app.getPath('userData');
    try {
        if (fs.existsSync(pointerFile())) {
            const parsed = JSON.parse(fs.readFileSync(pointerFile(), 'utf8'));
            const dir = parsed && typeof parsed.dataDir === 'string' && parsed.dataDir.trim() ? parsed.dataDir.trim() : '';
            if (dir) {
                fs.mkdirSync(dir, { recursive: true });
                app.setPath('userData', dir);
            }
        }
    } catch (err) {
        console.error('Failed to apply app data dir:', err.message);
    }
    return getDataDirInfo();
}

function getDataDirInfo() {
    const current = app.getPath('userData');
    return {
        current,
        default: defaultUserData || current,
        custom: !!(defaultUserData && defaultUserData !== current),
    };
}

function setDataDir(dir) {
    if (!dir) return { ok: false, error: 'No folder chosen.' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pointerFile(), JSON.stringify({ dataDir: dir }, null, 2), 'utf8');
    return { ok: true, ...getDataDirInfo() };
}

function resetDataDir() {
    try {
        fs.rmSync(pointerFile(), { force: true });
    } catch {}
    return { ok: true };
}

async function walkSize(dir) {
    let total = 0;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (e.name === 'data-dir.json') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            total += await walkSize(full);
        } else if (e.isFile()) {
            try { total += (await fs.promises.stat(full)).size; } catch {}
        }
    }
    return total;
}

async function copyTree(from, to, onProgress) {
    const fsP = fs.promises;
    await fsP.mkdir(to, { recursive: true });
    const total = await walkSize(from);
    let copied = 0;
    const emit = () => onProgress && onProgress({ copied, total, percent: total ? copied / total : 1 });
    async function rec(src, dst) {
        await fsP.mkdir(dst, { recursive: true });
        const entries = await fsP.readdir(src, { withFileTypes: true });
        for (const e of entries) {
            if (e.name === 'data-dir.json') continue;
            const s = path.join(src, e.name);
            const d = path.join(dst, e.name);
            if (e.isDirectory()) {
                await rec(s, d);
            } else if (e.isFile() || e.isSymbolicLink()) {
                await fsP.copyFile(s, d);
                try { copied += (await fsP.stat(s)).size; } catch {}
                emit();
            }
        }
    }
    await rec(from, to);
    emit();
}

/**
 * Copy the current app data (settings, backends, styles, themes) into the new
 * folder. Skips when the target already looks like an app data dir
 * (has settings.json) so re-pointing never clobbers an existing setup.
 */
async function migrate(from, to, onProgress) {
    const fromResolved = path.resolve(from);
    const toResolved = path.resolve(to);
    if (toResolved.startsWith(fromResolved + path.sep)) {
        return { ok: false, error: 'Cannot store app data inside the current app data folder.' };
    }
    if (fs.existsSync(path.join(toResolved, 'settings.json'))) {
        return { ok: true, migrated: false };
    }
    if (fs.existsSync(fromResolved)) {
        await copyTree(fromResolved, toResolved, onProgress);
    }
    return { ok: true, migrated: true };
}

module.exports = { applyDataDir, getDataDirInfo, setDataDir, resetDataDir, migrate, pointerFile };
