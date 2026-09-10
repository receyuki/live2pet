import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingSteps, OnboardingTour } from './OnboardingTour';

afterEach(() => cleanup());

describe('OnboardingTour', () => {
  it('localizes map progress and anchors the tour to compact panel headings', async () => {
    render(<>
      <section data-tour-id="map-animations"><header className="panel-heading">Animations</header></section>
      <section data-tour-id="map-preview"><header className="panel-heading">Preview</header></section>
      <section data-tour-id="map-assignment"><header className="panel-heading">Assignment</header></section>
      <OnboardingTour locale="zh-CN" stage="map" onComplete={vi.fn()} onSkip={vi.fn()} />
    </>);

    expect(await screen.findByRole('button', { name: '下一步（1/3）' })).toBeVisible();
    expect(createOnboardingSteps('zh-CN', 'map')).toMatchObject([
      { target: '[data-tour-id="map-animations"] .panel-heading', placement: 'bottom-start' },
      { target: '[data-tour-id="map-preview"] .panel-heading', placement: 'bottom' },
      { target: '[data-tour-id="map-assignment"] .panel-heading', placement: 'bottom-end' },
    ]);
  });

  it('anchors the build explanation to its heading instead of the full scrolling page', async () => {
    render(<>
      <main data-tour-id="build-options"><header className="page-heading">Build</header></main>
      <OnboardingTour locale="en" stage="build" onComplete={vi.fn()} onSkip={vi.fn()} />
    </>);

    expect(await screen.findByRole('alertdialog', { name: 'Build when ready' })).toBeVisible();
    expect(createOnboardingSteps('en', 'build')).toMatchObject([
      { target: '[data-tour-id="build-options"] > .page-heading', placement: 'bottom-start' },
    ]);
  });
});
