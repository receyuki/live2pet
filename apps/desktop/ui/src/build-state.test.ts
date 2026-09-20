import { describe, expect, it } from "vitest";
import { buildReducer, initialBuildState } from "./build-state";
const request = { requestId: 'request_12345678', projectId: 'pet', snapshotFingerprint: 'a'.repeat(64) };

const progress = (overrides: Partial<{ buildId: string; sequence: number; target: "clawd" | "codex-pet"; stage: string; status: string; fraction: number }> = {}) => ({
  protocolVersion: 1 as const,
  ...request,
  buildId: "build_12345678",
  sequence: 1,
  target: "clawd" as const,
  stage: "capture",
  status: "started",
  fraction: 0.5,
  ...overrides,
});

describe("buildReducer", () => {
  it('rejects late progress and completion after reset or another request starts', () => {
    const request = { requestId: 'old-request', projectId: 'pet', snapshotFingerprint: 'a'.repeat(64) };
    let state = buildReducer(initialBuildState(), { type: 'START', target: 'clawd', request, snapshot: 'old snapshot' });
    state = buildReducer(state, { type: 'RESET' });
    const completion = { type: 'SUCCEED' as const, target: 'clawd' as const, requestId: request.requestId, artifact: { artifactId: 'old', target: 'clawd' as const, filename: 'old.zip', byteLength: 1 }, summary: { target: 'clawd' as const } };
    expect(buildReducer(state, completion)).toBe(state);
    state = buildReducer(state, { type: 'START', target: 'clawd', request: { ...request, requestId: 'new-request' }, snapshot: 'new snapshot' });
    expect(buildReducer(state, { type: 'PROGRESS', event: { ...progress(), ...request } })).toBe(state);
    expect(buildReducer(state, completion)).toBe(state);
    expect(buildReducer(state, { type: 'FAIL', target: 'clawd', requestId: request.requestId, error: 'old failure' })).toBe(state);
  });
  it("shows real hosted-render progress before encoding starts", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd", request, snapshot: 'original' });
    state = buildReducer(state, { type: "PROGRESS", event: { ...progress({ stage: "render", status: "frame-completed" }), fraction: 0.25 } });
    expect(state.clawd.progress).toBeGreaterThan(0);
    expect(state.clawd.progress).toBeLessThan(50);
  });
  it("ignores stale sequences and events from another build id", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd", request, snapshot: 'original' });
    state = buildReducer(state, { type: "PROGRESS", event: progress() });
    const accepted = state;
    expect(buildReducer(state, { type: "PROGRESS", event: progress({ sequence: 1, fraction: 0.9 }) })).toBe(state);
    expect(buildReducer(state, { type: "PROGRESS", event: progress({ buildId: "build_87654321", sequence: 2 }) })).toBe(state);
    expect(accepted.clawd.progress).toBeGreaterThan(0);
  });

  it("counts concurrent capture and encode fractions without implying capture is complete", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd", request, snapshot: 'original' });
    state = buildReducer(state, { type: "PROGRESS", event: { ...progress({ stage: "encode", status: "started", fraction: 0 }), stageFractions: { capture: 0, validate: 1, encode: 0 } } });
    expect(state.clawd.progress).toBe(1);
    state = buildReducer(state, { type: "PROGRESS", event: { ...progress({ sequence: 2, stage: "encode", status: "motion-completed", fraction: 0.25 }), stageFractions: { capture: 0.25, validate: 1, encode: 0.25 } } });
    expect(state.clawd.progress).toBe(23);
    const accepted = state;
    expect(buildReducer(state, { type: "PROGRESS", event: { ...progress({ sequence: 3, stage: "encode" }), requestId: 'another-request', stageFractions: { capture: 1, validate: 1, encode: 1 } } })).toBe(accepted);
  });

  it("keeps target progress isolated", () => {
    let state = buildReducer(initialBuildState(), { type: "START", target: "codex-pet", request, snapshot: 'original' });
    state = buildReducer(state, { type: "PROGRESS", event: progress({ target: "codex-pet", stage: "encode" }) });
    expect(state["codex-pet"].status).toBe("building");
    expect(state.clawd).toEqual(initialBuildState().clawd);
  });

  it("clears active build metadata at terminal states and preserves the last successful artifact", () => {
    const artifact = { artifactId: "artifact-1", target: "clawd" as const, filename: "pet.zip", byteLength: 3 };
    const summary = { target: "clawd" as const, validation: { ok: true }, preview: { ready: true } };
    let state = buildReducer(initialBuildState(), { type: "START", target: "clawd", request, snapshot: 'original' });
    state = buildReducer(state, { type: "PROGRESS", event: progress() });
    state = buildReducer(state, { type: "SUCCEED", target: "clawd", requestId: request.requestId, artifact, summary });
    state = buildReducer(state, { type: "START", target: "clawd", request, snapshot: 'newer' });
    state = buildReducer(state, { type: "CANCEL", target: "clawd", requestId: request.requestId });
    expect(state.clawd).toMatchObject({ status: "cancelled", buildId: null, sequence: 0, artifact });
    expect(state.clawd.artifactSnapshot).toBe('original');
    state = buildReducer(state, { type: "START", target: "clawd", request, snapshot: 'newer' });
    state = buildReducer(state, { type: "FAIL", target: "clawd", requestId: request.requestId, error: "broken" });
    expect(state.clawd).toMatchObject({ status: "failed", buildId: null, artifact, error: "broken" });
    state = buildReducer(state, { type: 'START', target: 'clawd', request: { ...request, projectId: 'other' }, snapshot: 'other' });
    expect(state.clawd.artifact).toBeNull();
  });
});
