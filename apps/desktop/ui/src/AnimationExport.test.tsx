import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAnimationExport, validAnimationExportRender, animationExportPreset, animationExportStage } from './AnimationExport';
import type { AnimationExportProgress, AnimationExportRequest, AnimationExportResult, Live2PetProject, SourceInspection } from './app-host';
import * as host from './app-host';

const project: Live2PetProject = {
  schemaVersion: 3, projectId: 'test', name: 'Test', appVersion: '0.3.0',
  source: { kind: 'standard-directory', name: 'Test', fingerprint: 'a'.repeat(64) },
  recipes: [], visualSettings: { hiddenElementIds: ['background'] },
  targets: { clawd: { profile: 'clawd', mappings: {}, reactions: {}, options: { renderOverrides: { width: 256, height: 512, fps: 60, quality: 90 } } }, 'codex-pet': { profile: 'codex-pet', mappings: {}, reactions: {}, options: {} } },
};
const inspection: SourceInspection = {
  schemaVersion: 1, source: { kind: 'standard-directory', name: 'Test', fingerprint: 'a'.repeat(64), modelConfig: 'model3.json' },
  model: { cubism: 3, configFile: 'model3.json', modelFile: 'model.moc3', textures: [] },
  motions: ['idle', 'wave'].map(id => ({ id, name: id, group: '', index: 0, sourceFile: `${id}.json`, duration: 2 })),
  expressions: [{ id: 'smile', name: 'Smile', index: 0, sourceFile: 'smile.json' }], resources: [], warnings: [],
};
function Harness({ locale = 'en' as 'en' | 'zh-CN', expressions = true }) {
  const controller = useAnimationExport(locale);
  return <><button onClick={() => controller.open({ project, inspection: { ...inspection, expressions: expressions ? inspection.expressions : [] }, motionId: 'idle', expressionId: expressions ? 'smile' : null })}>Open export</button>{controller.status}{controller.dialog}</>;
}
const success = (input: AnimationExportRequest): AnimationExportResult => ({ requestId: input.requestId, cancelled: false, directoryId: 'out', directoryPath: '/output', files: input.motionIds.map(motionId => ({ motionId, filename: `${motionId}.webp`, byteLength: 10 })), failures: [] });
beforeEach(() => {
  vi.spyOn(host, 'getOutputSettings').mockResolvedValue({ schemaVersion: 1, mode: 'folder', folder: '/output' });
  vi.spyOn(host, 'onAnimationExportProgress').mockReturnValue(() => {});
  vi.spyOn(host, 'exportAnimations').mockImplementation(async input => success(input));
  vi.spyOn(host, 'openAnimationExportDirectory').mockResolvedValue({ opened: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('exports current motion without mappings and copies current Clawd specifications', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Open export'));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Use current Clawd specifications' }));
  expect(screen.getByLabelText('Canvas width')).toHaveValue(256);
  expect(screen.getByLabelText('Frame rate')).toHaveValue(60);
  fireEvent.click(screen.getByRole('button', { name: 'Export animations (1)' }));
  await screen.findByText('Animations saved: 1');
  const request = vi.mocked(host.exportAnimations).mock.calls[0][0];
  expect(request.motionIds).toEqual(['idle']);
  expect(request.expressionId).toBe('smile');
  expect(request.project.visualSettings).toEqual({ hiddenElementIds: ['background'] });
  expect(request.project.targets.clawd.mappings).toEqual({});
  expect(request.render).toEqual({ format: 'webp', preset: 'balanced', width: 256, height: 512, fps: 60, quality: 90, loop: true, lossless: false });
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
  expect(host.openAnimationExportDirectory).toHaveBeenCalledWith('out');
});

it('batch defaults to base expression, supports selection/search and hides expression controls when absent', async () => {
  render(<Harness expressions={false} />);
  fireEvent.click(screen.getByText('Open export'));
  await screen.findByRole('dialog');
  expect(screen.queryByText('Expression for all selected motions')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Select motions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByRole('button', { name: 'Export animations (0)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'wave' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export animations (1)' }));
  await waitFor(() => expect(host.exportAnimations).toHaveBeenCalled());
  expect(vi.mocked(host.exportAnimations).mock.calls[0][0]).toMatchObject({ motionIds: ['wave'], expressionId: null });
});

it('persists progress after closing, ignores unrelated/late events and supports cancellation', async () => {
  let listener!: (event: AnimationExportProgress) => void;
  vi.mocked(host.onAnimationExportProgress).mockImplementation(value => { listener = value; return () => {}; });
  let complete!: (value: AnimationExportResult) => void;
  vi.mocked(host.exportAnimations).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  vi.spyOn(host, 'cancelAnimationExport').mockResolvedValue({ cancelled: true });
  render(<Harness />);
  fireEvent.click(screen.getByText('Open export'));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'All motions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export animations (2)' }));
  const request = vi.mocked(host.exportAnimations).mock.calls[0][0];
  expect(request.expressionId).toBeNull();
  act(() => listener({ requestId: request.requestId, sequence: 2, stage: 'render', status: 'frame-completed', fraction: .4 }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  act(() => listener({ requestId: 'another', sequence: 5, stage: 'render', status: 'frame-completed', fraction: .9 }));
  fireEvent.click(screen.getByRole('button', { name: 'Export animations · 40%' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
  expect(host.cancelAnimationExport).toHaveBeenCalledWith(request.requestId);
  await act(async () => complete({ ...success(request), cancelled: true }));
  expect(screen.getByText('Export cancelled. Completed files have been kept.')).toBeInTheDocument();
});

it('uses the APNG setting and omits lossy controls', async () => {
  vi.mocked(host.getOutputSettings).mockResolvedValue({ schemaVersion: 1, mode: 'ask', animationFormat: 'apng' });
  render(<Harness />);
  fireEvent.click(screen.getByText('Open export'));
  await screen.findByText('APNG · lossless (larger files)');
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  expect(screen.queryByLabelText('WebP quality')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export animations (1)' }));
  await waitFor(() => expect(host.exportAnimations).toHaveBeenCalled());
  expect(vi.mocked(host.exportAnimations).mock.calls[0][0].render).toMatchObject({ format: 'apng', lossless: true });
});

it('validates custom specs, supports 60 FPS and translates controls', async () => {
  expect(validAnimationExportRender({ ...animationExportPreset('high'), fps: 60 })).toBe(true);
  expect(validAnimationExportRender({ ...animationExportPreset('high'), width: 4096 })).toBe(false);
  expect(animationExportStage({ requestId: 'id', sequence: 1, stage: 'encode', status: 'completed', cache: 'hit' })).toBe('exportCached');
  render(<Harness locale="zh-CN" />);
  fireEvent.click(screen.getByText('Open export'));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  fireEvent.change(screen.getByLabelText('画布宽度'), { target: { value: '4096' } });
  expect(screen.getByRole('button', { name: '导出 1 个动画' })).toBeDisabled();
});
