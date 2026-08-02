'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const BUNDLED_STYLES = path.join(__dirname, '..', 'styles.json');

function getStylesFilePath() {
    const userData = app.getPath('userData');
    const dest = path.join(userData, 'styles.json');
    if (!fs.existsSync(dest)) {
        try {
            fs.mkdirSync(userData, { recursive: true });
            if (fs.existsSync(BUNDLED_STYLES)) {
                fs.copyFileSync(BUNDLED_STYLES, dest);
            } else {
                fs.writeFileSync(dest, JSON.stringify({ description: 'Style templates', styles: [] }, null, 2), 'utf8');
            }
        } catch (err) {
            console.error('Failed to init styles file:', err.message);
        }
    }
    return dest;
}

function loadStyles() {
    const filePath = getStylesFilePath();
    let raw = [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed.styles) ? parsed.styles : [];
    } catch (err) {
        console.error('Failed to parse styles.json:', err.message);
        raw = [];
    }
    const styles = raw.map((s, i) => ({
        id: String(s.id != null ? s.id : i + 1),
        name: String(s.name || 'Style ' + (i + 1)),
        description: s.description || '',
        prompt: s.prompt || '',
        negative_prompt: s.negative_prompt || '',
    }));
    return { filePath, styles };
}

module.exports = { loadStyles, getStylesFilePath };
