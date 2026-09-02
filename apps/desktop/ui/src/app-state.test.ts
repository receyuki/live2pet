import { describe, expect, it } from "vitest";

import { appReducer, initialAppState } from "./app-state";

describe("initialAppState", () => {
  it("opens the first-run setup when setup has not been completed", () => {
    const state = initialAppState();

    expect(state.destination).toBe("setup");
    expect(state.setupStep).toBe("welcome");
    expect(state.project).toBeNull();
  });

  it("opens Welcome after setup has already been completed", () => {
    const state = initialAppState({ setupCompleted: true });

    expect(state.destination).toBe("welcome");
  });
});

describe("appReducer", () => {
  it("keeps project selections while navigating and visiting full-page Settings", () => {
    let state = initialAppState({ setupCompleted: true });

    state = appReducer(state, {
      type: "OPEN_PROJECT",
      project: {
        id: "saint-louis",
        name: "Saint Louis",
        sourcePath: "/models/saint-louis/model3.json",
      },
    });
    expect(state.destination).toBe("source");

    state = appReducer(state, { type: "NAVIGATE", destination: "map" });
    state = appReducer(state, { type: "SELECT_MOTION", motionId: "main_1" });
    state = appReducer(state, {
      type: "SELECT_EXPRESSION",
      expressionId: "smile",
    });
    state = appReducer(state, { type: "NAVIGATE", destination: "build" });
    state = appReducer(state, {
      type: "OPEN_SETTINGS",
      section: "storage",
    });

    expect(state.destination).toBe("settings");
    expect(state.settingsReturnDestination).toBe("build");
    expect(state.settingsSection).toBe("storage");
    expect(state.project?.selectedMotionId).toBe("main_1");
    expect(state.project?.selectedExpressionId).toBe("smile");

    state = appReducer(state, { type: "CLOSE_SETTINGS" });

    expect(state.destination).toBe("build");
    expect(state.settingsReturnDestination).toBeNull();
    expect(state.project?.selectedMotionId).toBe("main_1");
    expect(state.project?.selectedExpressionId).toBe("smile");
  });

  it("allows Settings to change sections without changing its return destination", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_SETTINGS" });
    state = appReducer(state, {
      type: "SELECT_SETTINGS_SECTION",
      section: "targets",
    });

    expect(state.settingsSection).toBe("targets");
    expect(state.settingsReturnDestination).toBe("welcome");
  });

  it("does not enter a project destination without an open project", () => {
    const state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "NAVIGATE",
      destination: "map",
    });

    expect(state.destination).toBe("welcome");
  });

  it("returns to Welcome and clears the session when a project closes", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, {
      type: "OPEN_PROJECT",
      project: { id: "vicious-khepri", name: "Vicious Khepri" },
    });
    state = appReducer(state, { type: "SELECT_MOTION", motionId: "idle" });

    state = appReducer(state, { type: "CLOSE_PROJECT" });

    expect(state.destination).toBe("welcome");
    expect(state.project).toBeNull();
  });

  it("reuses the same runtime settings in first-run Setup and full-page Settings", () => {
    let state = initialAppState();
    state = appReducer(state, { type: "BEGIN_SETUP", step: "runtimes" });
    state = appReducer(state, {
      type: "UPDATE_RUNTIME",
      family: "cubism4",
      runtime: {
        status: "ready",
        runtimeName: "live2dcubismcore.min.js",
        cubismGenerations: [3, 4, 5],
      },
    });
    state = appReducer(state, { type: "COMPLETE_SETUP" });
    state = appReducer(state, {
      type: "OPEN_SETTINGS",
      section: "runtimes",
    });

    expect(state.destination).toBe("settings");
    expect(state.settings.runtimes.cubism4).toEqual({
      status: "ready",
      runtimeName: "live2dcubismcore.min.js",
      cubismGenerations: [3, 4, 5],
    });
  });

  it("updates language, appearance, and reopen behavior without leaving Settings", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_SETTINGS", section: "general" });
    state = appReducer(state, { type: "UPDATE_LANGUAGE", language: "zh-CN" });
    state = appReducer(state, { type: "UPDATE_APPEARANCE", appearance: "dark" });
    state = appReducer(state, { type: "UPDATE_REOPEN_LAST_PROJECT", value: false });

    expect(state.destination).toBe("settings");
    expect(state.settings.language).toBe("zh-CN");
    expect(state.settings.appearance).toBe("dark");
    expect(state.settings.reopenLastProject).toBe(false);
  });

  it("preserves the current project when Setup is reopened from Help", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, {
      type: "OPEN_PROJECT",
      project: { id: "project-1", name: "Project 1" },
    });
    state = appReducer(state, { type: "NAVIGATE", destination: "map" });
    state = appReducer(state, { type: "BEGIN_SETUP" });
    state = appReducer(state, { type: "COMPLETE_SETUP" });

    expect(state.destination).toBe("map");
    expect(state.project?.id).toBe("project-1");
  });
});
