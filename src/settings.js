'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class SettingsStore {
    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'settings.json');
        this.data = {
            backendDir: '',
            modelDir: '',
            modelPath: '',
            diffusionModelPath: '',
            vaePath: '',
            textEncoderPath: '',
            loraDir: '',
            loraSlots: [],
            listenHost: '127.0.0.1',
            listenPort: 1234,
            extraArgs: '',
            autoStartServer: false,
            lastBackendZip: '',
            sizeMode: 'manual',
            ratioPreset: '1:1',
            ratioW: 1,
            ratioH: 1,
            megapixels: 1.0,
            width: 512,
            height: 512,
            selectedStyle: '',
            steps: 20,
            cfgScale: 7,
            seed: -1,
            batchCount: 1,
            sampler: 'euler_a',
            scheduler: 'discrete',
            outputFormat: 'png',
            theme: 'neutral'
        };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                const parsed = JSON.parse(raw);
                this.data = { ...this.data, ...parsed };
            }
        } catch (err) {
            console.error('Failed to load settings:', err.message);
        }
    }

    save() {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            console.error('Failed to save settings:', err.message);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }

    setAll(patch) {
        this.data = { ...this.data, ...patch };
        this.save();
    }
}

module.exports = { SettingsStore };
