(function exposeClawdProfile(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root) {
    const profiles = root.Live2PetTargetProfiles || (root.Live2PetTargetProfiles = {});
    profiles.clawd = factory();
  }
}(typeof globalThis === 'object' ? globalThis : this, function createClawdProfile() {
  const freezeList = (values) => Object.freeze([...values]);
  const renderPresets = Object.freeze({
    compact: Object.freeze({ width: 512, height: 512, fps: 18, quality: 76, alphaQuality: 100 }),
    balanced: Object.freeze({ width: 768, height: 768, fps: 24, quality: 82, alphaQuality: 100 }),
    high: Object.freeze({ width: 1024, height: 1024, fps: 30, quality: 88, alphaQuality: 100 }),
  });
  const coreStates = freezeList(['idle', 'thinking', 'working', 'sleeping']);
  const fullSleepStates = freezeList(['yawning', 'dozing', 'collapsing', 'waking']);
  const optionalStates = freezeList(['error', 'attention', 'notification', 'sweeping', 'carrying', 'juggling', 'roam']);
  const fallbackAllowed = freezeList(['sleeping', 'error', 'attention', 'notification', 'sweeping', 'carrying', 'roam']);
  return Object.freeze({
    id: 'clawd',
    contractVersion: 1,
    states: Object.freeze({
      core: coreStates,
      requiredDirect: freezeList(['idle', 'thinking', 'working']),
      fullSleep: fullSleepStates,
      optional: optionalStates,
      all: freezeList([...coreStates, ...optionalStates, ...fullSleepStates]),
      fallbackAllowed,
    }),
    reactions: freezeList(['drag', 'clickLeft', 'clickRight', 'annoyed', 'double']),
    sleepModes: freezeList(['direct', 'full']),
    renderPresets,
    defaultRenderPreset: 'balanced',
    package: Object.freeze({ maxBytes: 83_886_080 }),
  });
}));
