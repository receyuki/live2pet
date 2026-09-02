export type Destination =
  | "setup"
  | "welcome"
  | "source"
  | "map"
  | "build"
  | "settings";

export type ProjectDestination = Extract<
  Destination,
  "source" | "map" | "build"
>;

export type SettingsSection =
  | "general"
  | "runtimes"
  | "targets"
  | "storage";

export type SetupStep = "welcome" | "runtimes" | "finish";
export type RuntimeFamily = "cubism2" | "cubism4";

export interface RuntimeRegistration {
  status: "missing" | "ready";
  runtimeName: string | null;
  cubismGenerations: number[];
}

export interface AppSettings {
  language: "en" | "zh-CN";
  appearance: "system" | "light" | "dark";
  reopenLastProject: boolean;
  runtimes: Record<RuntimeFamily, RuntimeRegistration>;
}

export interface ProjectSession {
  id: string;
  name: string;
  sourcePath?: string;
  selectedMotionId: string | null;
  selectedExpressionId: string | null;
}

type ReturnDestination = "welcome" | ProjectDestination;

export interface AppState {
  destination: Destination;
  project: ProjectSession | null;
  settings: AppSettings;
  settingsSection: SettingsSection;
  settingsReturnDestination: ReturnDestination | null;
  setupStep: SetupStep;
  setupCompleted: boolean;
  setupReturnDestination: ReturnDestination;
}

export interface InitialAppStateOptions {
  setupCompleted?: boolean;
  settings?: AppSettings;
}

export type AppAction =
  | {
      type: "OPEN_PROJECT";
      project: Pick<ProjectSession, "id" | "name"> &
        Partial<
          Pick<
            ProjectSession,
            "sourcePath" | "selectedMotionId" | "selectedExpressionId"
          >
        >;
    }
  | { type: "CLOSE_PROJECT" }
  | { type: "NAVIGATE"; destination: ProjectDestination }
  | { type: "OPEN_SETTINGS"; section?: SettingsSection }
  | { type: "CLOSE_SETTINGS" }
  | { type: "SELECT_SETTINGS_SECTION"; section: SettingsSection }
  | { type: "SELECT_MOTION"; motionId: string | null }
  | { type: "SELECT_EXPRESSION"; expressionId: string | null }
  | { type: "BEGIN_SETUP"; step?: SetupStep }
  | { type: "COMPLETE_SETUP" }
  | {
      type: "UPDATE_RUNTIME";
      family: RuntimeFamily;
      runtime: RuntimeRegistration;
    }
  | { type: "UPDATE_LANGUAGE"; language: AppSettings["language"] }
  | { type: "UPDATE_APPEARANCE"; appearance: AppSettings["appearance"] }
  | { type: "UPDATE_REOPEN_LAST_PROJECT"; value: boolean };

function defaultSettings(): AppSettings {
  return {
    language: "en",
    appearance: "system",
    reopenLastProject: true,
    runtimes: {
      cubism2: { status: "missing", runtimeName: null, cubismGenerations: [2] },
      cubism4: { status: "missing", runtimeName: null, cubismGenerations: [3, 4, 5] },
    },
  };
}

export function initialAppState(
  options: InitialAppStateOptions = {},
): AppState {
  const setupCompleted = options.setupCompleted ?? false;

  return {
    destination: setupCompleted ? "welcome" : "setup",
    project: null,
    settings: options.settings ?? defaultSettings(),
    settingsSection: "general",
    settingsReturnDestination: null,
    setupStep: "welcome",
    setupCompleted,
    setupReturnDestination: "welcome",
  };
}

function safeReturnDestination(
  destination: ReturnDestination,
  project: ProjectSession | null,
): ReturnDestination {
  return destination === "welcome" || project ? destination : "welcome";
}

function destinationBeforeOverlay(state: AppState): ReturnDestination {
  if (state.destination === "settings") {
    return state.settingsReturnDestination ?? "welcome";
  }

  if (state.destination === "setup") {
    return state.setupReturnDestination;
  }

  return state.destination;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "OPEN_PROJECT":
      return {
        ...state,
        destination: "source",
        project: {
          ...action.project,
          selectedMotionId: action.project.selectedMotionId ?? null,
          selectedExpressionId: action.project.selectedExpressionId ?? null,
        },
        settingsReturnDestination: null,
      };

    case "CLOSE_PROJECT":
      return {
        ...state,
        destination: "welcome",
        project: null,
        settingsReturnDestination: null,
        setupReturnDestination: "welcome",
      };

    case "NAVIGATE":
      if (!state.project || state.destination === "setup") {
        return state;
      }

      return {
        ...state,
        destination: action.destination,
        settingsReturnDestination: null,
      };

    case "OPEN_SETTINGS": {
      const returnDestination = safeReturnDestination(
        destinationBeforeOverlay(state),
        state.project,
      );

      return {
        ...state,
        destination: "settings",
        settingsSection: action.section ?? state.settingsSection,
        settingsReturnDestination: returnDestination,
      };
    }

    case "CLOSE_SETTINGS": {
      if (state.destination !== "settings") {
        return state;
      }

      return {
        ...state,
        destination: safeReturnDestination(
          state.settingsReturnDestination ?? "welcome",
          state.project,
        ),
        settingsReturnDestination: null,
      };
    }

    case "SELECT_SETTINGS_SECTION":
      if (state.destination !== "settings") {
        return state;
      }

      return { ...state, settingsSection: action.section };

    case "SELECT_MOTION":
      if (!state.project) {
        return state;
      }

      return {
        ...state,
        project: { ...state.project, selectedMotionId: action.motionId },
      };

    case "SELECT_EXPRESSION":
      if (!state.project) {
        return state;
      }

      return {
        ...state,
        project: { ...state.project, selectedExpressionId: action.expressionId },
      };

    case "BEGIN_SETUP":
      if (state.destination === "setup") {
        return { ...state, setupStep: action.step ?? state.setupStep };
      }

      return {
        ...state,
        destination: "setup",
        setupStep: action.step ?? "welcome",
        setupReturnDestination: safeReturnDestination(
          destinationBeforeOverlay(state),
          state.project,
        ),
        settingsReturnDestination: null,
      };

    case "COMPLETE_SETUP":
      if (state.destination !== "setup") {
        return state;
      }

      return {
        ...state,
        destination: safeReturnDestination(
          state.setupReturnDestination,
          state.project,
        ),
        setupCompleted: true,
        setupStep: "welcome",
      };

    case "UPDATE_RUNTIME":
      return {
        ...state,
        settings: {
          ...state.settings,
          runtimes: {
            ...state.settings.runtimes,
            [action.family]: action.runtime,
          },
        },
      };

    case "UPDATE_LANGUAGE":
      return {
        ...state,
        settings: {
          ...state.settings,
          language: action.language,
        },
      };

    case "UPDATE_APPEARANCE":
      return {
        ...state,
        settings: {
          ...state.settings,
          appearance: action.appearance,
        },
      };

    case "UPDATE_REOPEN_LAST_PROJECT":
      return {
        ...state,
        settings: {
          ...state.settings,
          reopenLastProject: action.value,
        },
      };
  }
}
