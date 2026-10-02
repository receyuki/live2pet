const { Worker } = require('node:worker_threads');

function encodeApngStack({ stacked, width, height, frameCount, delays, loop }, { signal } = {}) {
  const cancelled = () => Object.assign(new Error('Animation encoding was cancelled.'), { code: 'BUILD_CANCELLED' });
  if (signal?.aborted) return Promise.reject(cancelled());
  // Transfer a dedicated buffer; pooled Buffer backing stores must not detach.
  const rgba = stacked.buffer.slice(stacked.byteOffset, stacked.byteOffset + stacked.byteLength);
  return new Promise((resolve, reject) => {
    const worker = new Worker(require.resolve('./apng-encoder-worker.cjs'), { workerData: { rgba, width, height, frameCount, delays, loop }, transferList: [rgba] });
    let settled = false;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(Buffer.from(bytes));
    };
    const abort = () => {
      // Wait for worker termination before releasing the shared memory lease.
      worker.terminate().then(() => finish(cancelled()), () => finish(cancelled()));
    };
    worker.once('message', bytes => finish(signal?.aborted ? cancelled() : null, bytes));
    worker.once('error', error => finish(Object.assign(error, { code: error.code || 'APNG_ENCODER_FAILED' })));
    worker.once('exit', code => { if (!settled) finish(signal?.aborted ? cancelled() : Object.assign(new Error(`APNG encoder exited before returning output (${code}).`), { code: 'APNG_ENCODER_FAILED' })); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

module.exports = { encodeApngStack };
