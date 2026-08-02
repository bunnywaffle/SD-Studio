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
    textEncoders: ['safetensors', 'gguf', 'bin', 'pt', 'ckpt', 'pth'],
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

function listFiles(dir, exts) {
    if (!dir || !fs.existsSync(dir)) return [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const out = [];
        for (const e of entries) {
            if (!e.isFile()) continue;
            const ext = path.extname(e.name).slice(1).toLowerCase();
            if (exts.includes(ext)) {
                out.push({ name: e.name, path: path.join(dir, e.name) });
            }
        }
        out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        return out;
    } catch {
        return [];
    }
}

function suggestDefaultDir() {
    const base = app.getPath('documents') || app.getPath('home');
    return path.join(base, 'SD.cpp Studio', 'models');
}

function scan(dir) {
    const subDirs = {};
    for (const [key, sub] of Object.entries(SUBDIRS)) {
        subDirs[key] = dir ? path.join(dir, sub) : '';
    }
    const exists = !!dir && fs.existsSync(dir);
    const structureComplete = exists && Object.values(subDirs).every((s) => fs.existsSync(s));
    const result = { models: [], loras: [], vae: [], textEncoders: [] };
    for (const key of Object.keys(SUBDIRS)) {
        result[key] = listFiles(subDirs[key], EXTENSIONS[key]);
    }
    return {
        dir: dir || '',
        exists,
        structureComplete,
        subDirs,
        suggestedDir: suggestDefaultDir(),
        ...result,
    };
}

module.exports = { SUBDIRS, EXTENSIONS, createStructure, listFiles, scan, suggestDefaultDir };
