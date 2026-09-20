const assert = require('node:assert/strict');
const test = require('node:test');

const { BUILD_PROGRESS_WEIGHTS, progressPercent } = require('../../mapper/build-progress.js');

test('weights long-running capture and encode work instead of dividing stages equally', () => {
  assert.equal(Object.values(BUILD_PROGRESS_WEIGHTS.clawd).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(BUILD_PROGRESS_WEIGHTS.codex).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(progressPercent('clawd', 'capture', 0), 0);
  assert.equal(progressPercent('clawd', 'capture', 0.5), 25);
  assert.equal(progressPercent('clawd', 'capture', 1), 50);
  assert.equal(progressPercent('clawd', 'encode', 0.5), 70);
  assert.equal(progressPercent('clawd', 'transfer', 1), 100);
});

test('progress remains monotonic at every Clawd stage boundary', () => {
  const stages = ['capture', 'validate', 'encode', 'manifest', 'preview', 'package', 'report', 'transfer'];
  const samples = stages.flatMap((stage) => [0, 0.25, 0.5, 0.75, 1].map((fraction) => progressPercent('clawd', stage, fraction)));
  assert.deepEqual(samples, [...samples].sort((left, right) => left - right));
});

test('overlapping Clawd capture and encode progress counts only completed work from public build events', async () => {
  const { buildProjectTargets } = require('../../../packages/package-build/src/index.cjs');
  const { SyntheticRenderer } = require('../../../packages/renderer/src/index.cjs');
  const { createProject } = require('../../../packages/project/src/index.cjs');
  const renderer = new SyntheticRenderer();
  const ids = ['idle', 'think', 'work', 'sleep'];
  await renderer.load({ motions: ids.map(id => ({ id, duration: 0.1 })) });
  const project = createProject({ projectId: 'progress', name: 'Progress', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: {
    clawd: { mappings: Object.fromEntries(['idle', 'thinking', 'working', 'sleeping'].map((state, index) => [state, `motion:${ids[index]}`])) },
  } });
  const events = [];
  const encodedByMotion = {};
  await buildProjectTargets({ project, targets: ['clawd'], inputsByTarget: { clawd: { renderer, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } },
    optionsByTarget: { clawd: { captureBudgetBytes: 1, onEncodedAsset: (id, asset) => { encodedByMotion[id] = asset; } } }, onProgress: event => events.push(event),
  });
  const value = event => progressPercent('clawd', event.stage === 'render' ? 'capture' : event.stage, event.fraction ?? (event.status === 'completed' ? 1 : 0), event.stageFractions);
  const encodeStart = events.find(event => event.stage === 'encode' && event.status === 'started');
  assert.ok(value(encodeStart) < 50, 'starting overlapping encode must not imply capture is finished');
  const partial = events.find(event => event.stage === 'encode' && event.status === 'motion-completed');
  assert.deepEqual(partial.stageFractions, { capture: 0.25, validate: 1, encode: 0.25 });
  assert.equal(value(partial), 23);
  const percentages = events.map(value);
  assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b));
  const partialHitEvents = [];
  await buildProjectTargets({ project, targets: ['clawd'], inputsByTarget: { clawd: { renderer, encodedByMotion: { idle: encodedByMotion.idle }, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } },
    optionsByTarget: { clawd: { captureBudgetBytes: 1 } }, onProgress: event => partialHitEvents.push(event),
  });
  const hit = partialHitEvents.find(event => event.stage === 'encode' && event.status === 'motion-completed' && event.cache === 'hit');
  assert.deepEqual(hit.stageFractions, { capture: 0, validate: 1, encode: 0.25 });
  assert.equal(value(hit), 11);
  const partialHitPercentages = partialHitEvents.map(value);
  assert.deepEqual(partialHitPercentages, [...partialHitPercentages].sort((a, b) => a - b));
});
