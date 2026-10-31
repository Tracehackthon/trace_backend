/**
 * The scope contract keeps facts that are commonly collapsed into one
 * `scope` value separate.  A Host Session is an attachment context; it is not
 * proof that the captured content belongs to that project or that it may be
 * activated in every other project.
 */
export declare const SCOPE_CONTRACT_PROTOCOL_ID = "trace.scope-contract";
export declare const SCOPE_CONTRACT_VERSION = 1;
export declare const SCOPE_CONTRACT_MIGRATION_ID = "product-workspace.scope-contract.v1";
export declare const SCOPE_CONTRACT_MIGRATION_VERSION = 1;
export declare const SCOPE_OWNER_KINDS: readonly string[];
export declare const SCOPE_CONTENT_KINDS: readonly string[];
export declare const SCOPE_DISCOVERY_MODES: readonly string[];
export declare const SCOPE_ACTIVATION_MODES: readonly string[];
export declare const SCOPE_CLASSIFICATION_LEVELS: readonly string[];
export declare const SCOPE_LIFECYCLE_STATUSES: readonly string[];
export declare const SCOPE_CERTAINTIES: readonly string[];
export declare const PROJECT_LINK_RELATIONS: readonly string[];
export declare class ScopeContractError extends Error {
    code: any;
    constructor(code: any, message: any);
}
/** Validate and return a normalized, immutable-by-convention scope contract. */
export declare function validateScopeContract(value: any): any;
/**
 * Conservative migration of the old one-dimensional `scope` field. The old
 * value is retained as provenance metadata, while owner, classification and
 * portable activation remain unknown unless an explicit project attachment
 * gives a safe project boundary.
 */
export declare function upcastLegacyScope({ scope, project_ref, host, session_id, turn_id, task_id, source_refs, status }?: {
    host?: any;
    project_ref?: any;
    scope?: string;
    session_id?: any;
    source_refs?: any[];
    status?: string;
    task_id?: any;
    turn_id?: any;
}): any;
/** Read a finding's new contract, or conservatively upcast its old columns. */
export declare function scopeContractFromFindingRow(row: any, { project_ref }?: {
    project_ref?: any;
}): any;
export declare function projectRefsFromContract(contract: any): any[];
export declare function scopeContractLegacyKind(contract: any): "domain" | "personal" | "project" | "team" | "unknown";
