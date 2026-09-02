export const BUILD_PROGRESS_WEIGHTS: Readonly<Record<'clawd' | 'codex', Readonly<Record<string, number>>>>;
export function progressPercent(target: 'clawd' | 'codex', stage: string, fractionValue: number): number;
