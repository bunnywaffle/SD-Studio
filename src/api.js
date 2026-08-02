'use strict';

const http = require('http');

class ServerApiClient {
    constructor(baseUrl, onLog) {
        this.baseUrl = baseUrl;
        this.onLog = onLog || (() => {});
    }

    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/+$/, '');
    }

    request(method, urlPath, body, timeoutMs = 300000) {
        return new Promise((resolve, reject) => {
            const target = new URL(this.baseUrl + urlPath);
            const data = body ? JSON.stringify(body) : null;
            const req = http.request(
                target,
                {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': data ? Buffer.byteLength(data) : 0,
                        'User-Agent': 'SDCppStudio/1.0',
                    },
                    timeout: timeoutMs,
                },
                (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        const parsed = raw ? safeParse(raw) : null;
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            const err = new Error(
                                `${method} ${urlPath} -> ${res.statusCode} ${raw.slice(0, 500)}`
                            );
                            err.status = res.statusCode;
                            err.body = parsed;
                            reject(err);
                        }
                    });
                }
            );
            req.on('timeout', () => {
                req.destroy(new Error(`Request to ${urlPath} timed out`));
            });
            req.on('error', (err) => {
                reject(err);
            });
            if (data) {
                req.write(data);
            }
            req.end();
        });
    }

    async ping() {
        try {
            await this.request('GET', '/sdcpp/v1/capabilities', null, 5000);
            return true;
        } catch {
            return false;
        }
    }

    async getCapabilities() {
        return this.request('GET', '/sdcpp/v1/capabilities');
    }

    async getSdModels() {
        try {
            return await this.request('GET', '/sdapi/v1/sd-models');
        } catch {
            return [];
        }
    }

    async getLoras() {
        try {
            return await this.request('GET', '/sdapi/v1/loras');
        } catch {
            return [];
        }
    }

    /**
     * Submit an image generation job (native async API).
     * Returns { id, pollUrl }.
     */
    async submitImageJob(payload) {
        const res = await this.request('POST', '/sdcpp/v1/img_gen', payload);
        return {
            id: res.id,
            pollUrl: res.poll_url || `/sdcpp/v1/jobs/${res.id}`,
        };
    }

    /**
     * Submit an image generation via the synchronous sdapi txt2img endpoint.
     * Returns { images: string[] } (base64).
     */
    async txt2img(payload) {
        const res = await this.request('POST', '/sdapi/v1/txt2img', payload);
        return res;
    }

    async getJob(jobId) {
        return this.request('GET', `/sdcpp/v1/jobs/${jobId}`);
    }

    async cancelJob(jobId) {
        try {
            return await this.request('POST', `/sdcpp/v1/jobs/${jobId}/cancel`);
        } catch (err) {
            if (err.status === 409) return { status: 'generating' };
            throw err;
        }
    }
}

function safeParse(str) {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}

module.exports = { ServerApiClient };
