import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { VisibilityPanel, soloVisualSettings } from './VisibilityPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const elements = [{ id: 'BG', name: 'Background', kind: 'part' as const }, { id: 'BODY', name: 'Body', kind: 'part' as const }];
it('Solo keeps ancestors and descendants without revealing sibling Parts', () => {
  const tree = [...elements, { id: 'FACE', name: 'Face', parentId: 'BODY', kind: 'part' as const }, { id: 'EYES', name: 'Eyes', parentId: 'FACE', kind: 'part' as const }, { id: 'ARM', name: 'Arm', parentId: 'BODY', kind: 'part' as const }];
  expect(soloVisualSettings(tree, 'FACE').hiddenElementIds).toEqual(['ARM', 'BG']);
});
it('searches friendly names/IDs and keeps Solo separate from saved hidden identities', async () => {
  const user = userEvent.setup();
  const onSettings = vi.fn(), onSolo = vi.fn();
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={null} busy={false} onSettings={onSettings} onSolo={onSolo} onInspect={vi.fn()} thumbnails={{}} onVisible={vi.fn()} />);
  await user.type(screen.getByRole('textbox'), 'bg');
  expect(screen.queryByRole('button', { name: 'Hide · Body' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Solo · Background' }));
  expect(onSolo).toHaveBeenLastCalledWith('BG');
  expect(onSettings).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Hide · Background' }));
  expect(onSettings).toHaveBeenCalledWith({ hiddenElementIds: ['BG'] });
});

it('provides Chinese recovery and an inseparable-model explanation', async () => {
  const onSettings = vi.fn();
  render(<VisibilityPanel locale="zh-CN" elements={[]} settings={{ hiddenElementIds: ['old-part'] }} soloId={null} thumbnail={null} busy={false} onSettings={onSettings} onSolo={vi.fn()} onInspect={vi.fn()} thumbnails={{}} onVisible={vi.fn()} />);
  expect(screen.getByText('此模型未提供可分离的部件。')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '全部恢复' }));
  expect(onSettings).toHaveBeenCalledWith({ hiddenElementIds: [] });
});

it('requests only the Part whose Inspect button is pressed and keeps its name plus ID visible', async () => {
  const user = userEvent.setup();
  const onInspect = vi.fn();
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={null} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={onInspect} thumbnails={{}} onVisible={vi.fn()} />);

  expect(screen.getByText('Background')).toBeVisible();
  expect(screen.getByText('BG')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Inspect · Background' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Inspect · Background' }));

  expect(onInspect).toHaveBeenCalledOnce();
  expect(onInspect).toHaveBeenCalledWith('BG');
  expect(onInspect).not.toHaveBeenCalledWith('BODY');
});

it('shows loading and current-pose empty states for the selected Part thumbnail', () => {
  const { rerender } = render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={{ id: 'BG', dataUrl: null, loading: true }} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={vi.fn()} thumbnails={{}} onVisible={vi.fn()} />);
  expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeVisible();
  expect(screen.getAllByText('Background')[0]).toBeVisible();
  expect(screen.getAllByText('BG')[0]).toBeVisible();

  rerender(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={{ id: 'BG', dataUrl: null, loading: false }} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={vi.fn()} thumbnails={{}} onVisible={vi.fn()} />);
  expect(screen.getByText('This Part has no visible pixels in the current pose.')).toBeVisible();
});

it('renders the isolated thumbnail returned for the selected Part', () => {
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={{ id: 'BG', dataUrl: 'data:image/png;base64,fixture', loading: false }} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={vi.fn()} thumbnails={{}} onVisible={vi.fn()} />);
  expect(screen.getByRole('img', { name: 'Background · BG' })).toHaveAttribute('src', 'data:image/png;base64,fixture');
});

it('shows inline images before selection and leaves the large preview unselected', async () => {
  const onInspect = vi.fn();
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={null} thumbnails={{ BG: { id: 'BG', dataUrl: 'data:image/png;base64,fixture', loading: false } }} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={onInspect} onVisible={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'Inspect · Background' });
  expect(within(button).getByRole('img', { name: 'Background · BG' })).toBeVisible();
  expect(onInspect).not.toHaveBeenCalled();
  expect(within(screen.getByRole('region', { name: 'Part preview' })).queryByRole('img')).toBeNull();
  await userEvent.click(button);
  expect(onInspect).toHaveBeenCalledWith('BG');
});

it('requests only intersecting rows and releases them when leaving the panel', () => {
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn(), onVisible = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { notify = callback; } observe() {} disconnect = disconnect; });
  const { container, unmount } = render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={null} thumbnails={{}} busy={false} onSettings={vi.fn()} onSolo={vi.fn()} onInspect={vi.fn()} onVisible={onVisible} />);
  const row = container.querySelector('[data-part-id="BODY"]')!;
  expect(onVisible).not.toHaveBeenCalled();
  notify([{ target: row, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(onVisible).toHaveBeenLastCalledWith(['BODY']);
  notify([{ target: row, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(onVisible).toHaveBeenLastCalledWith([]);
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('ranks detected Parts, uses their sampled images, and still requires an explicit hide', async () => {
  const onSettings = vi.fn();
  const props = { locale: 'en' as const, elements: [...elements].reverse(), settings: { hiddenElementIds: [] }, soloId: null, thumbnail: null, thumbnails: {}, busy: false, onSettings, onSolo: vi.fn(), onInspect: vi.fn(), onVisible: vi.fn(), scanScope: 'motion-one', onScan: vi.fn().mockResolvedValue({ motionId: 'one', candidates: [{ id: 'BG', dataUrl: 'data:image/png;base64,sampled', time: 2.5, areaRatio: 4 }] }) };
  const { container, rerender } = render(<VisibilityPanel {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Detect large Parts' }));
  expect(await screen.findByText('Large Part · 2.5s')).toBeVisible();
  expect(container.querySelector('[data-part-id]')).toHaveAttribute('data-part-id', 'BG');
  expect(onSettings).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Solo · Background' }));
  expect(props.onSolo).toHaveBeenLastCalledWith('BG', 2.5);
  await userEvent.click(screen.getByRole('button', { name: 'Inspect · Background' }));
  expect(within(screen.getByRole('region', { name: 'Part preview' })).getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,sampled');
  await userEvent.click(screen.getByRole('button', { name: 'Hide · Background' }));
  expect(onSettings).toHaveBeenCalledWith({ hiddenElementIds: ['BG'] });
  rerender(<VisibilityPanel {...props} scanScope="motion-two" />);
  expect(screen.queryByText('Large Part · 2.5s')).toBeNull();
  expect(container.querySelector('[data-part-id]')).toHaveAttribute('data-part-id', 'BODY');
});

it('shows a recoverable scan error without changing visibility', async () => {
  const onSettings = vi.fn();
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} thumbnail={null} thumbnails={{}} busy={false} onSettings={onSettings} onSolo={vi.fn()} onInspect={vi.fn()} onVisible={vi.fn()} onScan={vi.fn().mockRejectedValue(new Error('scan failed'))} />);
  await userEvent.click(screen.getByRole('button', { name: 'Detect large Parts' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('scan failed');
  expect(screen.getByRole('button', { name: 'Detect large Parts' })).toBeEnabled();
  expect(onSettings).not.toHaveBeenCalled();
});
