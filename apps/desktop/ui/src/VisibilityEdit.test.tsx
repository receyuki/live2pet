import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => { cleanup(); delete window.live2pet; window.history.replaceState(null, '', '/'); localStorage.clear(); });

it('opens the session directly in Visibility without touching normal project recovery', async () => {
  window.history.replaceState(null, '', '/?visibilityEdit=1');
  const session = {
    projectId: 'visibility-0123456789abcdef0123456789abcdef', name: 'External model', locale: 'en',
    visualSettings: { hiddenElementIds: ['PartBG'] },
    inspection: { schemaVersion: 1, source: { kind: 'standard-directory', name: 'External model', fingerprint: 'a'.repeat(64), modelConfig: 'model.model3.json' }, model: { cubism: 3, configFile: 'model.model3.json', modelFile: 'model.moc3', textures: [] }, motions: [], expressions: [], resources: [], warnings: [] },
  };
  const finish = vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { status: 'cancelled' } }));
  localStorage.setItem('live2pet.desktop.project-draft', 'ordinary recovery');
  window.live2pet = {
    getVisibilityEditSession: async () => ({ protocolVersion: 1, ok: true, result: session }),
    finishVisibilityEdit: finish,
  } as unknown as NonNullable<Window['live2pet']>;
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Apply and return' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Visibility' })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull();
  expect(screen.queryByText('Assignment')).toBeNull();
  expect(localStorage.getItem('live2pet.desktop.project-draft')).toBe('ordinary recovery');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  expect(finish).toHaveBeenCalledWith({ status: 'cancelled' });
});
