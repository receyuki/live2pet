declare module "@live2pet/clawd-target/profile" {
  const profile: Readonly<{
    id: "clawd";
    states: Readonly<{ core: readonly string[]; requiredDirect: readonly string[]; fullSleep: readonly string[]; optional: readonly string[]; all: readonly string[]; fallbackAllowed: readonly string[] }>;
    reactions: readonly string[];
  }>;
  export default profile;
}

declare module "@live2pet/codex-target/profile" {
  const profile: Readonly<{ id: "codex-pet"; rows: readonly Readonly<{ id: string; frames: number }>[]; rowIds: readonly string[] }>;
  export default profile;
}
