import type {TemplateBundleManifest} from '../../contract/src/index.js';

export interface SelectableTemplate {id: string; manifest_path: string; display_name: string; purpose: string; cognitive_source_mode: NonNullable<TemplateBundleManifest['cognitive_source']>['mode']; requires_source_selection: boolean;}

export const SELECTABLE_TEMPLATES: readonly SelectableTemplate[] = [
  {id: 'trace.codex-starter', manifest_path: 'templates/codex-starter/manifest.json', display_name: 'Trace Codex Starter', purpose: 'MyWiKi + Codex collaborative reasoning with user-selected cognitive source', cognitive_source_mode: 'user-selected', requires_source_selection: true},
  {id: 'trace.codex-empty', manifest_path: 'templates/codex-empty/manifest.json', display_name: 'Trace Codex Empty', purpose: 'Structure-only cold start without importing semantic content', cognitive_source_mode: 'isolated-empty', requires_source_selection: false},
  {id: 'trace.codex-team', manifest_path: 'templates/codex-team/manifest.json', display_name: 'Trace Codex Team', purpose: 'Team-shared governance with explicit team source selection', cognitive_source_mode: 'team-shared', requires_source_selection: true},
];

export function findSelectableTemplate(id: string): SelectableTemplate { const item = SELECTABLE_TEMPLATES.find(entry => entry.id === id); if (!item) throw new Error(`Unknown Trace template: ${id}`); return item; }
