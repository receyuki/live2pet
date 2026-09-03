(function exposeCodexProfile(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root) {
    const profiles = root.Live2PetTargetProfiles || (root.Live2PetTargetProfiles = {});
    profiles.codexPet = factory();
  }
}(typeof globalThis === 'object' ? globalThis : this, function createCodexProfile() {
  const freezeList = (values) => Object.freeze([...values]);
  const atlas = Object.freeze({ width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
  // Codex 26.901.20858 adds 16 static look-direction cells after the nine animation rows.
  const atlases = Object.freeze({ 1: atlas, 2: Object.freeze({ ...atlas, height: 2288, rows: 11 }) });
  // Verified against the installed Codex host on 2026-09-03; milliseconds per frame.
  const frameDurations = Object.freeze({
    idle: freezeList([280, 110, 110, 140, 140, 320]),
    'running-right': freezeList([120, 120, 120, 120, 120, 120, 120, 220]),
    'running-left': freezeList([120, 120, 120, 120, 120, 120, 120, 220]),
    waving: freezeList([140, 140, 140, 280]),
    jumping: freezeList([140, 140, 140, 140, 280]),
    failed: freezeList([140, 140, 140, 140, 140, 140, 140, 240]),
    waiting: freezeList([150, 150, 150, 150, 150, 260]),
    running: freezeList([120, 120, 120, 120, 120, 220]),
    review: freezeList([150, 150, 150, 150, 150, 280]),
  });
  const rows = Object.freeze([
    Object.freeze({ id: 'idle', frames: 6 }),
    Object.freeze({ id: 'running-right', frames: 8 }),
    Object.freeze({ id: 'running-left', frames: 8 }),
    Object.freeze({ id: 'waving', frames: 4 }),
    Object.freeze({ id: 'jumping', frames: 5 }),
    Object.freeze({ id: 'failed', frames: 8 }),
    Object.freeze({ id: 'waiting', frames: 6 }),
    Object.freeze({ id: 'running', frames: 6 }),
    Object.freeze({ id: 'review', frames: 6 }),
  ]);
  const renderPresets = Object.freeze({
    compact: Object.freeze({ width: atlas.cellWidth, height: atlas.cellHeight, samplesPerSecond: 32 }),
    balanced: Object.freeze({ width: atlas.cellWidth, height: atlas.cellHeight, samplesPerSecond: 64 }),
    high: Object.freeze({ width: atlas.cellWidth, height: atlas.cellHeight, samplesPerSecond: 96 }),
  });
  return Object.freeze({
    id: 'codex-pet',
    contractVersion: 1,
    atlas,
    frameDurations,
    atlases,
    rows,
    rowIds: freezeList(rows.map((row) => row.id)),
    renderPresets,
    defaultRenderPreset: 'balanced',
    package: Object.freeze({ files: freezeList(['pet.json', 'spritesheet.webp']) }),
  });
}));
