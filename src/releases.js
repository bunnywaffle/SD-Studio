'use strict';

const https = require('https');
const { URL } = require('url');

const REPO = 'leejet/stable-diffusion.cpp';
const API_BASE = `https://api.github.com/repos/${REPO}`;

function fetchJson(url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request(
            parsed,
            {
                method: 'GET',
                headers: {
                    'User-Agent': 'SDCppStudio/1.0',
                    Accept: 'application/vnd.github+json',
                },
            },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
                    return;
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitHub API returned ${res.statusCode}: ${body.slice(0, 300)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch (err) {
                        reject(new Error('Failed to parse GitHub API response'));
                    }
                });
            }
        );
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Request timed out'));
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Get the latest release from the stable-diffusion.cpp GitHub repo.
 */
async function getLatestRelease() {
    const release = await fetchJson(`${API_BASE}/releases/latest`);
    return {
        tag: release.tag_name,
        name: release.name || release.tag_name,
        publishedAt: release.published_at,
        assets: (release.assets || []).map((a) => ({
            name: a.name,
            size: a.size,
            url: a.browser_download_url,
            downloadCount: a.download_count,
        })),
    };
}

/**
 * Get a paginated list of recent releases.
 */
async function getReleases(page = 1, perPage = 10) {
    const releases = await fetchJson(`${API_BASE}/releases?page=${page}&per_page=${perPage}`);
    return releases.map((r) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        assets: (r.assets || []).map((a) => ({
            name: a.name,
            size: a.size,
            url: a.browser_download_url,
            downloadCount: a.download_count,
        })),
    }));
}

/**
 * Given an asset name, decide whether it matches the current OS/arch and return a label.
 * Returns null if the asset is not relevant.
 */
function classifyAsset(name) {
    const lower = name.toLowerCase();
    if (!lower.includes('sd-master') && !lower.includes('sd-main')) {
        return null;
    }
    if (!lower.endsWith('.zip')) {
        return null;
    }

    let variant = 'cpu';
    if (lower.includes('cuda')) variant = 'cuda';
    else if (lower.includes('vulkan')) variant = 'vulkan';
    else if (lower.includes('rocm')) variant = 'rocm';
    else if (lower.includes('opencl')) variant = 'opencl';
    else if (lower.includes('sycl')) variant = 'sycl';
    else if (lower.includes('metal')) variant = 'metal';

    let os = '';
    let arch = '';
    if (lower.includes('win')) {
        os = 'win';
        arch = lower.includes('arm64') ? 'arm64' : 'x64';
    } else if (lower.includes('darwin') || lower.includes('macos')) {
        os = 'mac';
        arch = lower.includes('arm64') ? 'arm64' : 'x64';
    } else if (lower.includes('linux')) {
        os = 'linux';
        arch = lower.includes('aarch64') || lower.includes('arm64') ? 'arm64' : 'x64';
    } else {
        return null;
    }

    return { os, arch, variant, name };
}

/**
 * Return the preferred asset names for the current platform, ordered by preference.
 */
function preferredAssets(assets, os = null, arch = null) {
    const currentOs = os || process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const currentArch = arch || (process.arch === 'arm64' ? 'arm64' : 'x64');

    const matching = assets
        .map((a) => ({ asset: a, cls: classifyAsset(a.name) }))
        .filter((x) => x.cls && x.cls.os === currentOs && x.cls.arch === currentArch);

    // Prefer cpu, then vulkan, then cuda, etc.
    const order = { cpu: 0, metal: 1, vulkan: 2, cuda: 3, opencl: 4, rocm: 5, sycl: 6 };
    matching.sort((a, b) => {
        const oa = order[a.cls.variant] ?? 99;
        const ob = order[b.cls.variant] ?? 99;
        return oa - ob;
    });
    return matching.map((x) => x.asset);
}

module.exports = {
    getLatestRelease,
    getReleases,
    classifyAsset,
    preferredAssets,
};
