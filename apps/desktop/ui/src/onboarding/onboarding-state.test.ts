import { describe, expect, it } from 'vitest';
import { completeOnboardingStage, ONBOARDING_KEY, readOnboardingState, replayOnboarding, selectOnboardingStage, skipOnboarding, writeOnboardingState } from './onboarding-state';

function memoryStorage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    values,
  };
}

describe('onboarding state', () => {
  it('starts only for a genuinely new installation', () => {
    expect(readOnboardingState(memoryStorage())).toMatchObject({ status: 'active', completedStages: [] });
    expect(readOnboardingState(memoryStorage({ 'live2pet.desktop.locale': 'en' }))).toMatchObject({ status: 'completed' });
    expect(readOnboardingState(memoryStorage({ 'live2pet.desktop.setup-completed': 'true' }))).toMatchObject({ status: 'completed' });
  });

  it('persists progress, tolerates invalid data, and replays explicitly', () => {
    const storage = memoryStorage();
    const progressed = completeOnboardingStage(readOnboardingState(storage), 'map');
    expect(progressed.completedStages).toEqual(['models', 'library', 'preview', 'map']);
    writeOnboardingState(progressed, storage);
    expect(readOnboardingState(storage)).toEqual(progressed);
    storage.values[ONBOARDING_KEY] = '{broken';
    expect(readOnboardingState(storage).status).toBe('active');
    expect(replayOnboarding()).toMatchObject({ status: 'active', completedStages: [] });
    expect(skipOnboarding(progressed).status).toBe('skipped');
  });

  it('shows only the tutorial stage available in the current UI', () => {
    let state = replayOnboarding();
    expect(selectOnboardingStage(state, { destination: 'welcome', hasLibrary: false, hasPreview: false })).toBe('models');
    state = completeOnboardingStage(state, 'models');
    expect(selectOnboardingStage(state, { destination: 'welcome', hasLibrary: false, hasPreview: false })).toBeNull();
    expect(selectOnboardingStage(state, { destination: 'welcome', hasLibrary: true, hasPreview: false })).toBe('library');
    expect(selectOnboardingStage(state, { destination: 'map', hasLibrary: false, hasPreview: false })).toBe('map');
  });
});
