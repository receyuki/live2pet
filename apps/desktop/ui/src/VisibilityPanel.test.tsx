import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { VisibilityPanel, soloVisualSettings } from './VisibilityPanel';

afterEach(cleanup);
const elements = [{ id: 'BG', name: 'Background', kind: 'part' as const }, { id: 'BODY', name: 'Body', kind: 'part' as const }];
it('Solo keeps ancestors and descendants without revealing sibling Parts', () => {
  const tree = [...elements, { id: 'FACE', name: 'Face', parentId: 'BODY', kind: 'part' as const }, { id: 'EYES', name: 'Eyes', parentId: 'FACE', kind: 'part' as const }, { id: 'ARM', name: 'Arm', parentId: 'BODY', kind: 'part' as const }];
  expect(soloVisualSettings(tree, 'FACE').hiddenElementIds).toEqual(['ARM', 'BG']);
});
it('searches friendly names/IDs and keeps Solo separate from saved hidden identities', async () => {
  const user = userEvent.setup();
  const onSettings = vi.fn(), onSolo = vi.fn();
  render(<VisibilityPanel locale="en" elements={elements} settings={{ hiddenElementIds: [] }} soloId={null} busy={false} onSettings={onSettings} onSolo={onSolo} onClose={vi.fn()} />);
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
  render(<VisibilityPanel locale="zh-CN" elements={[]} settings={{ hiddenElementIds: ['old-part'] }} soloId={null} busy={false} onSettings={onSettings} onSolo={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText('此模型未提供可分离的部件。')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '全部恢复' }));
  expect(onSettings).toHaveBeenCalledWith({ hiddenElementIds: [] });
});
