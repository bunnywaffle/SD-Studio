'use strict';

// Mock sd-server for testing the generation flow.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '7777', 10);
let jobs = {};
let counter = 0;

// 1x1 red PNG
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
}

const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
        const url = req.url.split('?')[0];
        const body = raw ? JSON.parse(raw) : {};

        if (req.method === 'GET' && url === '/sdcpp/v1/capabilities') {
            sendJson(res, 200, {
                model: { name: 'mock-model', stem: 'mock', path: '/mock.gguf' },
                current_mode: 'img_gen',
                supported_modes: ['img_gen'],
                defaults: {
                    prompt: '', negative_prompt: '', width: 512, height: 512,
                    seed: 42, batch_count: 1,
                    sample_params: {
                        scheduler: 'discrete', sample_method: 'euler_a', sample_steps: 20,
                        guidance: { txt_cfg: 7.0, img_cfg: null, distilled_guidance: 3.5 },
                    },
                    output_format: 'png', output_compression: 100,
                },
                samplers: ['euler', 'euler_a', 'heun', 'dpm2', 'dpm++2m', 'dpm++2s_a', 'lcm'],
                schedulers: ['discrete', 'normal', 'karras', 'exponential', 'ays', 'gits'],
                output_formats: ['png', 'jpeg', 'webp'],
                loras: [
                    { name: 'marblesh', path: 'marblesh.safetensors' },
                    { name: 'detail', path: 'detail.gguf' },
                ],
                limits: { min_width: 64, max_width: 4096, min_height: 64, max_height: 4096, max_batch_count: 8, max_queue_size: 8 },
            });
            return;
        }

        if (req.method === 'GET' && url === '/sdapi/v1/loras') {
            sendJson(res, 200, [
                { name: 'marblesh', path: 'marblesh.safetensors' },
                { name: 'detail', path: 'detail.gguf' },
            ]);
            return;
        }

        if (req.method === 'GET' && url === '/sdapi/v1/sd-models') {
            sendJson(res, 200, []);
            return;
        }

        if (req.method === 'POST' && url === '/sdcpp/v1/img_gen') {
            const id = 'job_test_' + (++counter);
            const created = Math.floor(Date.now() / 1000);
            jobs[id] = {
                id, kind: 'img_gen', status: 'queued', created, started: null, completed: null,
                queue_position: 0, result: null, error: null,
                received_lora: body.lora || [],
                received_prompt: body.prompt,
                received_steps: body.sample_params && body.sample_params.sample_steps,
                received_cfg: body.sample_params && body.sample_params.guidance && body.sample_params.guidance.txt_cfg,
            };
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id, kind: 'img_gen', status: 'queued', created, poll_url: `/sdcpp/v1/jobs/${id}` }));

            // simulate progress: generating -> completed after 1.5s
            setTimeout(() => {
                if (jobs[id]) jobs[id].status = 'generating';
            }, 300);
            setTimeout(() => {
                if (!jobs[id]) return;
                jobs[id].status = 'completed';
                jobs[id].completed = Math.floor(Date.now() / 1000);
                const n = body.batch_count || 1;
                jobs[id].result = {
                    output_format: 'png',
                    images: Array.from({ length: n }, (_, i) => ({
                        index: i,
                        b64_json: PNG_1PX.toString('base64'),
                    })),
                };
            }, 1500);
            return;
        }

        const jobMatch = url.match(/^\/sdcpp\/v1\/jobs\/([A-Za-z0-9_-]+)$/);
        if (req.method === 'GET' && jobMatch) {
            const job = jobs[jobMatch[1]];
            if (!job) { sendJson(res, 404, { error: 'job not found' }); return; }
            sendJson(res, 200, job);
            return;
        }

        const cancelMatch = url.match(/^\/sdcpp\/v1\/jobs\/([A-Za-z0-9_-]+)\/cancel$/);
        if (req.method === 'POST' && cancelMatch) {
            const job = jobs[cancelMatch[1]];
            if (!job) { sendJson(res, 404, { error: 'job not found' }); return; }
            if (job.status === 'generating') { sendJson(res, 409, { error: 'generating' }); return; }
            job.status = 'cancelled';
            job.completed = Math.floor(Date.now() / 1000);
            job.error = { code: 'cancelled', message: 'job cancelled by client' };
            sendJson(res, 200, job);
            return;
        }

        if (req.method === 'POST' && url === '/sdapi/v1/txt2img') {
            const n = body.batch_size || 1;
            sendJson(res, 200, {
                images: Array.from({ length: n }, () => PNG_1PX.toString('base64')),
                parameters: body,
                info: '',
            });
            return;
        }

        sendJson(res, 404, { error: 'not found: ' + req.method + ' ' + url });
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`MOCK-READY ${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
