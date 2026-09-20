const { performance } = require('node:perf_hooks');

const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;

function cancelled() {
  return Object.assign(new Error('Build cancelled.'), { code: 'BUILD_CANCELLED' });
}

function createPool(budgetBytes) {
  let bytes = 0;
  let count = 0;
  const waiting = [];
  function drain() {
    while (waiting.length) {
      const next = waiting[0];
      // One oversized Motion may run alone: do not silently reduce quality.
      if (count && (count >= 2 || bytes + next.bytes > budgetBytes)) break;
      waiting.shift();
      next.signal.removeEventListener('abort', next.abort);
      bytes += next.bytes;
      count += 1;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        bytes -= next.bytes;
        count -= 1;
        drain();
      });
    }
  }
  return {
    budgetBytes,
    acquire(bytes, signal) {
      if (signal.aborted) return Promise.reject(cancelled());
      return new Promise((resolve, reject) => {
        const entry = { bytes, signal, resolve, abort: () => {
          const index = waiting.indexOf(entry);
          if (index !== -1) waiting.splice(index, 1);
          reject(cancelled());
          drain();
        } };
        signal.addEventListener('abort', entry.abort, { once: true });
        waiting.push(entry);
        drain();
      });
    },
  };
}

const sharedPool = createPool(DEFAULT_BUDGET_BYTES);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Producer errors can precede the encoder requesting this Motion.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function createCapturePipeline({ motionIds, withRenderer, prepare, estimateBytes, capture, signal, budgetBytes }) {
  if (budgetBytes !== undefined && (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0)) {
    throw new TypeError('captureBudgetBytes must be a positive safe integer.');
  }
  const pool = budgetBytes === undefined ? sharedPool : createPool(budgetBytes);
  const controller = new AbortController();
  const ready = deferred();
  const entries = new Map(motionIds.map(id => [id, deferred()]));
  const metrics = { budgetBytes: pool.budgetBytes, peakReservedBytes: 0, peakResidentMotions: 0,
    maxMotionReservationBytes: 0, oversizedMotions: 0, waitMs: 0, reservedBytes: 0 };
  let resident = 0;
  let failure;
  function stop(error) {
    failure ||= error;
    controller.abort();
    ready.reject(failure);
    for (const entry of entries.values()) {
      entry.reject(failure);
      if (entry.payload) {
        entry.payload.frameSet = null;
        entry.payload.release();
        entry.payload = null;
      }
    }
  }
  const abort = () => stop(cancelled());
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const done = Promise.resolve().then(() => withRenderer(async (renderer, cacheOptions) => {
    if (failure) throw failure;
    await prepare(renderer, cacheOptions, controller.signal);
    ready.resolve();
    for (const [index, id] of motionIds.entries()) {
      if (failure) throw failure;
      const bytes = estimateBytes(renderer, id);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError('Invalid Motion capture reservation.');
      const started = performance.now();
      const releasePool = await pool.acquire(bytes, controller.signal);
      metrics.waitMs += performance.now() - started;
      metrics.reservedBytes += bytes;
      resident += 1;
      metrics.peakReservedBytes = Math.max(metrics.peakReservedBytes, metrics.reservedBytes);
      metrics.peakResidentMotions = Math.max(metrics.peakResidentMotions, resident);
      metrics.maxMotionReservationBytes = Math.max(metrics.maxMotionReservationBytes, bytes);
      if (bytes > pool.budgetBytes) metrics.oversizedMotions += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        metrics.reservedBytes -= bytes;
        resident -= 1;
        releasePool();
      };
      try {
        let frameSet = await capture(renderer, id, index, controller.signal);
        if (failure) throw failure;
        const entry = entries.get(id);
        entry.payload = { frameSet, release };
        entry.resolve(entry.payload);
        frameSet = null;
      } catch (error) {
        release();
        throw error;
      }
    }
  })).catch(error => { stop(error); throw failure; });
  done.catch(() => {});
  return {
    ready: ready.promise,
    metrics,
    async withFrameSet(id, consume) {
      try {
        const entry = entries.get(id);
        const payload = await entry.promise;
        entries.delete(id);
        entry.payload = null;
        try {
          // The final encode/package must not keep the native lease alive.
          if (id === motionIds.at(-1)) await done;
          if (failure) throw failure;
          return await consume(payload.frameSet);
        } finally {
          payload.frameSet = null;
          payload.release();
        }
      } catch (error) {
        stop(error);
        throw failure;
      }
    },
    async finish(error) {
      if (error) stop(error);
      try { await done; } finally {
        signal?.removeEventListener('abort', abort);
        for (const entry of entries.values()) {
          if (entry.payload) {
            entry.payload.frameSet = null;
            entry.payload.release();
            entry.payload = null;
          }
        }
        entries.clear();
      }
      if (failure) throw failure;
    },
  };
}

module.exports = { createCapturePipeline };
