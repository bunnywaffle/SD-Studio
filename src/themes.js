'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

function bundledThemesDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'themes');
    }
    return path.join(app.getAppPath(), 'themes');
}

function userThemesDir() {
    const dir = path.join(app.getPath('userData'), 'themes');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Copy any bundled theme css files into the user's themes dir on first run,
 * so they always have editable copies. Existing user files are never overwritten.
 */
function seedThemes() {
    const src = bundledThemesDir();
    const dst = userThemesDir();
    if (!fs.existsSync(src)) return;
    let entries = [];
    try {
        entries = fs.readdirSync(src, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.css')) continue;
        const out = path.join(dst, entry.name);
        if (!fs.existsSync(out)) {
            try {
                fs.copyFileSync(path.join(src, entry.name), out);
            } catch {}
        }
    }
}

/**
 * List available themes as [{ name, file }] from the user themes dir.
 */
function listThemes() {
    seedThemes();
    const dir = userThemesDir();
    const themes = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.css')) continue;
        themes.push({ name: path.basename(entry.name, '.css'), file: path.join(dir, entry.name) });
    }
    return themes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read a theme's CSS text by name (or first theme / empty fallback).
 */
function getThemeCss(name) {
    const themes = listThemes();
    const theme = themes.find((t) => t.name === name) || themes[0];
    if (!theme) return '';
    try {
        return fs.readFileSync(theme.file, 'utf8');
    } catch {
        return '';
    }
}

function openThemesDir() {
    const dir = userThemesDir();
    seedThemes();
    shell.openPath(dir);
    return dir;
}

module.exports = { bundledThemesDir, userThemesDir, seedThemes, listThemes, getThemeCss, openThemesDir };
