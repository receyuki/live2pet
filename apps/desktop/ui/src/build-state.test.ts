import { describe, expect, it } from "vitest";
import { buildReducer, initialBuildState } from "./build-state";

const progress = (overrides: Partial<{ buildId: string; sequence: number; target: "clawd" | "codex-pet"; stage: string; status: string; fraction: number }> = {}) => ({
  protocolVersion: 1 as const,
  buildId: "build_12345678",
  sequence: 1,
  target: "clawd" as const,
  stage: "capture",
  status: "started",
  fraction: 0.5,
  ...overrides,
});

describe("buildReducer", () => {
  it("shows real hosted-render progress before encoding starts", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd" });
    state = buildReducer(state, { type: "PROGRESS", event: { ...progress({ stage: "render", status: "frame-completed" }), fraction: 0.25 } });
    expect(state.clawd.progress).toBeGreaterThan(0);
    expect(state.clawd.progress).toBeLessThan(50);
  });
  it("ignores stale sequences and events from another build id", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd" });
    state = buildReducer(state, { type: "PROGRESS", event: progress() });
    const accepted = state;
    expect(buildReducer(state, { type: "PROGRESS", event: progress({ sequence: 1, fraction: 0.9 }) })).toBe(state);
    expect(buildReducer(state, { type: "PROGRESS", event: progress({ buildId: "build_87654321", sequence: 2 }) })).toBe(state);
    expect(accepted.clawd.progress).toBeGreaterThan(0);
  });

  it("keeps target progress isolated", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "codex-pet" });
    state = buildReducer(state, { type: "PROGRESS", event: progress({ target: "codex-pet", stage: "encode" }) });
    expect(state["codex-pet"].status).toBe("building");
    expect(state.clawd).toEqual(initialBuildState().clawd);
  });

  it("clears active build metadata at terminal states and preserves the last successful artifact", () => {
    const artifact = { artifactId: "artifact-1", target: "clawd" as const, filename: "pet.zip", byteLength: 3 };
    const summary = { target: "clawd" as const, validation: { ok: true }, preview: { ready: true } };
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd" });
    state = buildReducer(state, { type: "PROGRESS", event: progress() });
    state = buildReducer(state, { type: "SUCCEED", target: "clawd", artifact, summary });
    state = buildReducer(state, { type: "START", target: "clawd" });
    state = buildReducer(state, { type: "CANCEL", target: "clawd" });
    expect(state.clawd).toMatchObject({ status: "cancelled", buildId: null, sequence: 0, artifact });
    state = buildReducer(state, { type: "START", target: "clawd" });
    state = buildReducer(state, { type: "FAIL", target: "clawd", error: "broken" });
    expect(state.clawd).toMatchObject({ status: "failed", buildId: null, artifact, error: "broken" });
  });
});
