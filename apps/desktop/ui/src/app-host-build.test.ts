import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { buildProject, getBuildArtifact } from './app-host';
import { CODEX_PROFILE } from './target-profiles';
import { parseGeneratedPreview } from './generated-preview';

const require = createRequire(import.meta.url);
const { createAppIpcRouter } = require('../../../../packages/app-host/src/index.cjs');
const { buildProjectTargets } = require('../../../../packages/package-build/src/index.cjs');
const { createProject } = require('../../../../packages/project/src/index.cjs');

afterEach(() => { Object.defineProperty(window, 'live2pet', { configurable: true, value: undefined }); });

it.each(['clawd', 'codex-pet'] as const)('requests a downloadable %s ZIP through the real App build contract', async (target) => {
  const project = createProject({
    projectId: 'ui-build-fixture', name: 'UI Build Fixture',
    source: { kind: 'synthetic', name: 'fixture', fingerprint: 'a'.repeat(64) },
    targets: {
      clawd: { mappings: Object.fromEntries(['idle', 'thinking', 'working', 'sleeping'].map((id) => [id, 'motion:idle'])) },
      'codex-pet': { mappings: Object.fromEntries(CODEX_PROFILE.rowIds.map((id) => [id, 'motion:idle'])) },
    },
  });
  const frames = Array.from({ length: 8 }, (_, index) => ({
    id: `frame-${index}`, index, time: index / 8, visualChange: 1,
    width: 192, height: 208, bounds: { x: 0, y: 0, width: 1, height: 1 },
    rgba: new Uint8Array(192 * 208 * 4).fill(255),
  }));
  const inputsByTarget = target === 'clawd'
    ? { clawd: { framesByMotion: { idle: { frames, fps: 12 } } } }
    : { 'codex-pet': { candidatesByRow: Object.fromEntries(CODEX_PROFILE.rowIds.map((id) => [id, frames])) } };
  const router = createAppIpcRouter({ buildProjectService: buildProjectTargets });
  const invoke = (method: string, input: unknown) => router({ protocolVersion: 1, method, args: [input] });
  Object.defineProperty(window, 'live2pet', { configurable: true, value: {
    buildProject: (input: object) => invoke('buildProject', { ...input, inputsByTarget }),
    getBuildArtifact: (artifactId: string, offset: number) => invoke('getBuildArtifact', { artifactId, offset }),
    cancelBuild: () => {}, chooseInstallRoot: () => {}, installArtifact: () => {},
  } });
  const result = await buildProject(project, target);
  expect(result.artifacts).toHaveLength(1);
  expect(result.builds[target]?.validation?.ok).toBe(true);
  const artifact = await getBuildArtifact(result.artifacts[0].artifactId);
  expect(artifact.filename).toMatch(/\.zip$/);
  expect(artifact.filename).toContain('ui-build-fixture');
  expect([...artifact.bytes.subarray(0, 2)]).toEqual([80, 75]);
  if (target === 'codex-pet') {
    const preview = await parseGeneratedPreview(artifact.bytes, target);
    expect(preview.target).toBe('codex-pet');
    if (preview.target === 'codex-pet') {
      expect(preview.atlas.height).toBe(2288);
      expect(preview.rows.at(-1)?.id).toBe('neutral-look');
    }
  }
});
