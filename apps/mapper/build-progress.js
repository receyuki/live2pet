(function exposeBuildProgress(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Live2PetBuildProgress = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const BUILD_PROGRESS_WEIGHTS = Object.freeze({
    clawd: Object.freeze({ capture: 50, validate: 1, encode: 38, manifest: 1, preview: 1, package: 5, report: 2, transfer: 2 }),
    codex: Object.freeze({ capture: 40, select: 8, layout: 3, compose: 8, encode: 16, manifest: 2, preview: 2, package: 10, report: 4, transfer: 7 }),
  });

  function progressPercent(target, stage, fractionValue) {
    const weights = BUILD_PROGRESS_WEIGHTS[target];
    if (!weights || !Object.hasOwn(weights, stage)) return 0;
    const fraction = Math.max(0, Math.min(1, Number(fractionValue) || 0));
    let completed = 0;
    for (const [candidate, weight] of Object.entries(weights)) {
      if (candidate === stage) {
        completed += weight * fraction;
        break;
      }
      completed += weight;
    }
    if (completed >= 100) return 100;
    return Math.max(0, Math.min(99, Math.round(completed)));
  }

  return Object.freeze({ BUILD_PROGRESS_WEIGHTS, progressPercent });
});
