import type { SourceInspection } from './app-host';
import type { ProjectSession } from './app-state';

// Both direct import and library confirmation enter the same editable document flow.
export function projectFromSource({ projectId, appVersion, sourcePath, inspection, motion }: {
  projectId: string; appVersion: string; sourcePath: string; inspection: SourceInspection; motion: string;
}): ProjectSession {
  const { kind, name, fingerprint, modelConfig } = inspection.source;
  return {
    id: projectId, name, sourcePath, inspection, dirty: true,
    selectedMotionId: motion || inspection.motions[0]?.id || null,
    selectedExpressionId: null,
    document: {
      format: 'live2pet-project', schemaVersion: 3, projectId, appVersion, name,
      source: { kind, name, path: sourcePath, fingerprint, modelConfig },
      recipes: [], visualSettings: { hiddenElementIds: [] },
      targets: {
        clawd: { profile: 'clawd', mappings: {}, reactions: {}, options: {} },
        'codex-pet': { profile: 'codex-pet', mappings: {}, reactions: {}, options: {} },
      },
    },
  };
}
