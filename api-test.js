'use strict';

// API client integration test against the mock server.
const { ServerApiClient } = require('./src/api');

const api = new ServerApiClient('http://127.0.0.1:7777');

(async () => {
    const caps = await api.getCapabilities();
    console.log('capabilities ok:', !!caps.model, 'samplers:', caps.samplers.length, 'loras:', caps.loras.length);

    const loras = await api.getLoras();
    console.log('loras:', JSON.stringify(loras));

    const job = await api.submitImageJob({
        prompt: 'a cat',
        negative_prompt: 'blur',
        width: 512,
        height: 512,
        seed: -1,
        batch_count: 1,
        sample_params: {
            scheduler: 'discrete',
            sample_method: 'euler_a',
            sample_steps: 20,
            guidance: { txt_cfg: 7.0 },
        },
        lora: [{ path: 'marblesh.safetensors', multiplier: 0.8 }],
        output_format: 'png',
        output_compression: 100,
    });
    console.log('job submitted:', job.id);

    for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const j = await api.getJob(job.id);
        if (j.status === 'completed') {
            const imgs = (j.result && j.result.images) || [];
            console.log('completed, images:', imgs.length, 'first img bytes:', imgs[0] ? imgs[0].b64_json.length : 0);
            console.log('ALL-TESTS-PASS');
            process.exit(0);
        } else {
            console.log('status:', j.status);
        }
    }
    console.error('TIMEOUT waiting for completion');
    process.exit(1);
})().catch((e) => {
    console.error('TEST FAIL:', e.message);
    process.exit(1);
});
