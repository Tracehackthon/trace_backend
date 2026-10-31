/** Resolve an explicit repeated import to its first saved snapshot. No I/O,
 * inferred relationship or mutation; command and preview use the same input. */
export declare function resolveComparisonMaterial(host: any, material: any): any;
export declare function createBridge(): {
    schemaVersion: number;
    chain: {
        schemaVersion: number;
        nextId: number;
        screen: string;
        selectedId: any;
        isDemo: boolean;
        notice: string;
        matters: any[];
        sessions: {};
        sources: any;
        unassignedMaterials: any[];
        capture: {
            text: string;
            sourceIds: any[];
            excerpt: string;
            excerptSourceId: any;
        };
        collapseUndo: any;
    };
    comparisons: {};
    worksite: {
        [x: string]: any;
    };
    workGuards: {};
    route: {
        view: string;
    };
    error: any;
};
/** Host-issued IDs, never title-based lookup. No understanding is inferred. */
export declare function captureInput(host: any, { matterId, text, source }?: {}): any;
/**
 * Preserve explicit provider provenance to a source that was already captured through
 * the normal product command path. This does not fetch, link, adopt or revise
 * anything or verify an author; it preserves the declared public snapshot origin.
 */
export declare function attachProviderSourceProvenance(host: any, { matterId, sourceId, provenance }?: {}): any;
/** Keep one explicit public-search result as material for an existing matter.
 * Search never mutates the original expression or infers a relationship. */
export declare function keepPublicSource(host: any, { matterId, source, query }?: {}): any;
/** Existing chain actions, explicitly addressed to an object rather than a UI selection. */
export declare function dispatchChain(host: any, { matterId, action, expectedUnderstandingVersion }?: {}): any;
export declare function selectChain(host: any, matterId: any): any;
/** Derive real content versions and UTF-16 offsets for UI entry points. Null means no valid selection. */
export declare function selectComparisonAnchor(host: any, matterId: any, options?: {}): {
    field: any;
    objectId: any;
    expressionId: any;
    sourceId?: any;
    start: any;
    end: any;
    text: any;
    baseVersion: any;
};
/** Comparison basis is separate from saved understanding; original input can be compared immediately. */
export declare function openComparison(host: any, { sessionId, matterId, anchor, returnTarget }?: {}): any;
export declare function dispatchComparison(host: any, { sessionId, action }?: {}): any;
export declare function selectComparison(host: any, sessionId: any, capability?: {}): {
    screen: any;
    matter: {
        id: any;
        title: any;
        originalText: any;
        understanding: any;
        version: any;
        focus: any;
        basis: any;
        unresolved: any;
    };
    query: any;
    candidates: any;
    selectedId: any;
    selectedCandidate: any;
    comparisonDraft: any;
    savedComparisonNote: any;
    comparison: any;
    revision: {
        open: any;
        draft: any;
        before: any;
        after: any;
        mode: any;
        target: any;
        requiresUnderstandingTarget: boolean;
        baseVersion: any;
        canConfirm: boolean;
    };
    request: any;
    receipt: any;
    canUndo: boolean;
    pending: boolean;
    directionOptions: any;
    scopeOptions: any;
    relationOptions: any;
    notice: any;
    isDemo: boolean;
    search: any;
    currentUnderstandingVersion: any;
    returnTarget: any;
    hostError: any;
};
/** In-memory transaction boundary; a real persistence owner must persist BEFORE delivering the outcome. */
export declare function applyPendingComparison(host: any, { sessionId, requestId }?: {}): {
    host: any;
    outcome: any;
};
/** ACK affects only the comparison view. It can never replace authoritative matter content. */
export declare function deliverComparisonResult(host: any, { sessionId, requestId, outcome }?: {}): any;
export declare function commitComparison(host: any, ids: any): any;
/** Recover an interrupted UI ACK from the authoritative command ledger, never replay a mutation on load. */
export declare function recoverPendingComparisons(host: any): any;
export declare function returnFromComparison(host: any, sessionId: any): any;
/** Confirmed snapshot is historical, not another current understanding object. */
export declare function createWorkFromHandoff(host: any, { matterId, workId, destination, role, note, selectedText }?: {
    note?: string;
    role?: string;
}): any;
/** Project current matters for one reducer call, commit permitted differences, then discard projection. */
export declare function dispatchWorksite(host: any, { workId, action }?: {}): any;
export declare function selectWorksite(host: any, workId: any): any;
