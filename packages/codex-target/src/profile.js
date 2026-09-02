(function exposeCodexProfile(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root) {
    const profiles = root.Live2PetTargetProfiles || (root.Live2PetTargetProfiles = {});
    profiles.codexPet = factory();
  }
}(typeof globalThis === 'object' ? globalThis : this, function createCodexProfile() {
  const freezeList = (values) => Object.freeze([...values]);
  const atlas = Object.freeze({ width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
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
    rows,
    rowIds: freezeList(rows.map((row) => row.id)),
    renderPresets,
    defaultRenderPreset: 'balanced',
    package: Object.freeze({ files: freezeList(['pet.json', 'spritesheet.webp']) }),
  });
}));
