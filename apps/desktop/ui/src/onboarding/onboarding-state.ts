export const ONBOARDING_KEY = 'live2pet.desktop.onboarding';
export const ONBOARDING_TOUR_VERSION = 1;

export const onboardingStages = ['models', 'library', 'preview', 'map', 'build'] as const;
export type OnboardingStage = typeof onboardingStages[number];
export type OnboardingStatus = 'active' | 'completed' | 'skipped';

export type OnboardingState = {
  schemaVersion: 1;
  tourVersion: 1;
  status: OnboardingStatus;
  completedStages: OnboardingStage[];
};

type OnboardingContext = {
  destination: string;
  hasLibrary: boolean;
  hasPreview: boolean;
};

function validStage(value: unknown): value is OnboardingStage {
  return onboardingStages.includes(value as OnboardingStage);
}

function existingInstallation(storage: Pick<Storage, 'getItem'>): boolean {
  return ['live2pet.desktop.setup-completed', 'live2pet.desktop.locale'].some((key) => storage.getItem(key) !== null);
}

export function readOnboardingState(storage: Pick<Storage, 'getItem'>): OnboardingState {
  try {
    const parsed = JSON.parse(storage.getItem(ONBOARDING_KEY) ?? 'null') as Partial<OnboardingState> | null;
    if (parsed?.schemaVersion === 1 && parsed.tourVersion === ONBOARDING_TOUR_VERSION && ['active', 'completed', 'skipped'].includes(parsed.status ?? '')) {
      return {
        schemaVersion: 1,
        tourVersion: ONBOARDING_TOUR_VERSION,
        status: parsed.status as OnboardingStatus,
        completedStages: Array.isArray(parsed.completedStages) ? [...new Set(parsed.completedStages.filter(validStage))] : [],
      };
    }
  } catch { /* Invalid local state starts from a safe default. */ }
  return existingInstallation(storage)
    ? { schemaVersion: 1, tourVersion: ONBOARDING_TOUR_VERSION, status: 'completed', completedStages: [...onboardingStages] }
    : { schemaVersion: 1, tourVersion: ONBOARDING_TOUR_VERSION, status: 'active', completedStages: [] };
}

export function writeOnboardingState(state: OnboardingState, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(ONBOARDING_KEY, JSON.stringify(state));
}

export function completeOnboardingStage(state: OnboardingState, stage: OnboardingStage): OnboardingState {
  const index = onboardingStages.indexOf(stage);
  const completedStages = onboardingStages.filter((_, stageIndex) => stageIndex <= index || state.completedStages.includes(onboardingStages[stageIndex]));
  return { ...state, status: stage === 'build' ? 'completed' : 'active', completedStages };
}

export function skipOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, status: 'skipped' };
}

export function replayOnboarding(): OnboardingState {
  return { schemaVersion: 1, tourVersion: ONBOARDING_TOUR_VERSION, status: 'active', completedStages: [] };
}

export function selectOnboardingStage(state: OnboardingState, context: OnboardingContext): OnboardingStage | null {
  if (state.status !== 'active') return null;
  const done = (stage: OnboardingStage) => state.completedStages.includes(stage);
  if (context.destination === 'welcome') {
    if (!done('models')) return 'models';
    if (context.hasLibrary && !done('library')) return 'library';
    if (context.hasPreview && !done('preview')) return 'preview';
    return null;
  }
  if (context.destination === 'map' && !done('map')) return 'map';
  if (context.destination === 'build' && !done('build')) return 'build';
  return null;
}
