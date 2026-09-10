import { useEffect, useMemo } from 'react';
import { EVENTS, Joyride, STATUS, type EventData, type Step } from 'react-joyride';
import { translate, type Locale, type MessageKey } from '../i18n';
import type { OnboardingStage } from './onboarding-state';

type Props = {
  locale: Locale;
  stage: OnboardingStage;
  onComplete: (stage: OnboardingStage) => void;
  onSkip: () => void;
};

const definitions: Record<OnboardingStage, Array<{ target: string; title: MessageKey; content: MessageKey; placement?: Step['placement'] }>> = {
  models: [{ target: '[data-tour-id="models-import"]', title: 'tourModelsTitle', content: 'tourModelsBody', placement: 'bottom-start' }],
  library: [{ target: '[data-tour-id="model-library"]', title: 'tourLibraryTitle', content: 'tourLibraryBody', placement: 'top-start' }],
  preview: [{ target: '[data-tour-id="model-preview"]', title: 'tourPreviewTitle', content: 'tourPreviewBody', placement: 'left-start' }],
  map: [
    { target: '[data-tour-id="map-animations"]', title: 'tourMapAnimationsTitle', content: 'tourMapAnimationsBody', placement: 'right-start' },
    { target: '[data-tour-id="map-preview"]', title: 'tourMapPreviewTitle', content: 'tourMapPreviewBody', placement: 'bottom' },
    { target: '[data-tour-id="map-assignment"]', title: 'tourMapAssignmentTitle', content: 'tourMapAssignmentBody', placement: 'left-start' },
  ],
  build: [{ target: '[data-tour-id="build-options"]', title: 'tourBuildTitle', content: 'tourBuildBody', placement: 'top' }],
};

export function OnboardingTour({ locale, stage, onComplete, onSkip }: Props) {
  const t = (key: MessageKey) => translate(locale, key);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = useMemo<Step[]>(() => definitions[stage].map((step) => ({
    ...step,
    title: translate(locale, step.title),
    content: translate(locale, step.content),
  })), [locale, stage]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onSkip();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onSkip]);

  function handleEvent(event: EventData) {
    if (event.type !== EVENTS.TOUR_END) return;
    if (event.status === STATUS.SKIPPED) onSkip();
    else if (event.status === STATUS.FINISHED) onComplete(stage);
  }

  return <Joyride
    key={`${locale}:${stage}`}
    run
    continuous
    steps={steps}
    onEvent={handleEvent}
    locale={{
      back: t('tourBack'),
      close: t('tourClose'),
      last: t('tourDone'),
      next: t('tourNext'),
      nextWithProgress: t('tourNextProgress'),
      open: t('tourOpen'),
      skip: t('tourSkip'),
    }}
    options={{
      buttons: ['back', 'skip', 'primary', 'close'],
      closeButtonAction: 'skip',
      dismissKeyAction: false,
      overlayClickAction: false,
      showProgress: true,
      skipBeacon: true,
      targetWaitTimeout: 750,
      scrollDuration: reducedMotion ? 0 : 220,
      spotlightPadding: 8,
      spotlightRadius: 14,
      primaryColor: 'var(--brand)',
      backgroundColor: 'var(--raised)',
      textColor: 'var(--text)',
      overlayColor: 'var(--tour-overlay)',
      zIndex: 1000,
    }}
    styles={{
      tooltip: { border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: 'var(--shadow)' },
      tooltipContainer: { lineHeight: 1.55, textAlign: 'start' },
      tooltipTitle: { fontSize: 16, fontWeight: 700 },
      tooltipContent: { fontSize: 13 },
      buttonPrimary: { borderRadius: 10, minHeight: 36, paddingInline: 16 },
      buttonBack: { color: 'var(--muted)', minHeight: 36 },
      buttonSkip: { color: 'var(--muted)', minHeight: 36 },
      buttonClose: { color: 'var(--muted)' },
    }}
  />;
}
