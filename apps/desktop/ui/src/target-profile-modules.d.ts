declare module "@live2pet/clawd-target/profile" {
  const profile: Readonly<{
    id: "clawd";
    renderPresets: Readonly<Record<'compact' | 'balanced' | 'high', Readonly<{ width: number; height: number; fps: number; quality: number; alphaQuality: number }>>>;
    package: Readonly<{ maxBytes: number }>;
    states: Readonly<{ core: readonly string[]; requiredDirect: readonly string[]; fullSleep: readonly string[]; optional: readonly string[]; all: readonly string[]; fallbackAllowed: readonly string[] }>;
    reactions: readonly string[];
  }>;
  export default profile;
}

declare module "@live2pet/codex-target/profile" {
  const profile: Readonly<{ id: "codex-pet"; atlases: Readonly<Record<1 | 2, Readonly<{ width: number; height: number; columns: number; rows: number; cellWidth: number; cellHeight: number }>>>; rows: readonly Readonly<{ id: string; frames: number }>[]; rowIds: readonly string[]; frameDurations: Readonly<Record<string, readonly number[]>> }>;
  export default profile;
}
