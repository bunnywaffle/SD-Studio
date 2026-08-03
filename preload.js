'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sdcpp', {
    // settings
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

    // style templates (styles.json)
    getStyles: () => ipcRenderer.invoke('styles:get'),
    openStylesFile: () => ipcRenderer.invoke('styles:openFile'),

    // themes (user-editable css in userData/themes)
    listThemes: () => ipcRenderer.invoke('theme:list'),
    getTheme: (name) => ipcRenderer.invoke('theme:get', name),
    openThemesDir: () => ipcRenderer.invoke('theme:openDir'),

    // models (folder-based detection)
    getModels: () => ipcRenderer.invoke('models:get'),
    chooseModelsDir: () => ipcRenderer.invoke('models:chooseDir'),
    setModelsDir: (dir) => ipcRenderer.invoke('models:setDir', dir),
    createModelsStructure: (dir) => ipcRenderer.invoke('models:createStructure', dir),

    // backend
    getBackendState: () => ipcRenderer.invoke('backend:state'),
    listReleaseAssets: (page) => ipcRenderer.invoke('backend:listReleaseAssets', { page }),
    getLatestRelease: () => ipcRenderer.invoke('backend:latestRelease'),
    downloadAsset: (assetUrl, assetName, tag) =>
        ipcRenderer.invoke('backend:downloadAsset', { assetUrl, assetName, tag }),
    importZip: () => ipcRenderer.invoke('backend:importZip'),
    chooseZip: () => ipcRenderer.invoke('backend:chooseZip'),
    linkBackendDir: (dir) => ipcRenderer.invoke('backend:linkFolder', dir),
    startServer: () => ipcRenderer.invoke('backend:start'),
    stopServer: () => ipcRenderer.invoke('backend:stop'),
    validateDir: (dir) => ipcRenderer.invoke('backend:validateDir', dir),

    // dialogs
    pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
    pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
    pickDirectory: (opts) => ipcRenderer.invoke('dialog:pickDirectory', opts),
    saveImage: (opts) => ipcRenderer.invoke('dialog:saveImage', opts),
    openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
    writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', { filePath, data }),

    // generation
    txt2img: (payload) => ipcRenderer.invoke('gen:txt2img', payload),
    submitJob: (payload) => ipcRenderer.invoke('gen:submit', payload),
    getJob: (jobId) => ipcRenderer.invoke('gen:job', jobId),
    cancelJob: (jobId) => ipcRenderer.invoke('gen:cancel', jobId),
    getCapabilities: () => ipcRenderer.invoke('gen:capabilities'),
    getLoras: () => ipcRenderer.invoke('gen:loras'),

    // events
    onBackendUpdate: (cb) => ipcRenderer.on('backend:update', (e, payload) => cb(payload)),
    onDownloadProgress: (cb) => ipcRenderer.on('backend:downloadProgress', (e, payload) => cb(payload)),
    onServerReady: (cb) => ipcRenderer.on('server:ready', (e, payload) => cb(payload)),
});
