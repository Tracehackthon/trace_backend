/** Pure comparison session and reference host. No network, persistence, DOM, or model calls. */
export declare const SCREENS: readonly string[];
export declare const DIRECTION_OPTIONS: readonly {
    value: string;
    label: string;
}[];
export declare const SCOPE_OPTIONS: readonly {
    value: string;
    label: string;
}[];
export declare const RELATION_OPTIONS: readonly {
    value: string;
    label: string;
}[];
/** A fresh session always begins before searching. Supplied candidates are a local catalog, not search results. */
export declare function createComparisonState({ matter, candidates, sessionId }?: {
    candidates?: {
        id: string;
        title: string;
        kind: string;
        sourceType: string;
        excerpt: string;
        summary: string;
        context: string;
        url: any;
        scopes: string[];
        relationship: {
            type: string;
            target: string;
            summary: string;
            reason: string;
            uncertain: string;
        };
        comparison: {
            same: string;
            different: string;
            unknown: string;
        };
    }[];
    matter?: {
        id: string;
        title: string;
        understanding: string;
        version: number;
        focus: {
            start: number;
            end: number;
            text: string;
        };
        unresolved: string;
        links: any[];
        revisions: any[];
    };
    sessionId?: string;
}): {
    schemaVersion: number;
    sessionId: string;
    nextId: number;
    screen: string;
    isDemo: boolean;
    notice: string;
    matter: any;
    catalog: any[];
    candidateIds: any[];
    selectedId: any;
    fixtureQuestion: boolean;
    query: {
        question: any;
        direction: string;
        instructions: string;
        scopes: string[];
    };
    search: {
        status: string;
        isDemo: boolean;
        provider: string;
        request: any;
    };
    drafts: {};
    notes: {};
    revision: {
        open: boolean;
        candidateId: any;
        draft: string;
        before: string;
        baseVersion: number;
    };
    request: any;
    receipt: any;
};
/** Classifies an import without mutating the comparison or replacing its first source snapshot. */
export declare function classifyMaterialImport(state: any, material?: {}): string;
/** Only COMMIT_RESULT can replace the host snapshot; requests alone never claim a mutation succeeded. */
export declare function reduceComparison(previous: any, action?: {}): any;
/** Stable public view. Consumers never need catalog/draft maps or any reducer-private fields. */
export declare function selectComparisonView(state: any): {
    screen: any;
    isDemo: any;
    notice: any;
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
    search: any;
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
};
/**
 * Pure illustrative host transaction. A real host must apply the same guards atomically against its current matter.
 * understanding version changes only for revision/undo; all unrelated fields and material links survive undo.
 */
export declare function applyComparisonRequest(currentMatter: any, request: any): {
    ok: boolean;
    matter: any;
    receipt: any;
    error: {
        code: any;
        message: any;
    };
};
/** Fixtures traverse the same request/commit pipeline; they are never a shortcut for real host success. */
export declare function createComparisonDemo(screen?: string): any;
