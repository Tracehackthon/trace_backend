export declare function createActivationRules({ need, strictObject: shape, identity, integer, one, list, optional, validContentRef: ref, stableWorkbenchJson: stable, resolveContentRef: resolve, validateReferenceSelection: select, contentReferencesOverlap: overlap, instructionRefs }: {
    contentReferencesOverlap: any;
    identity: any;
    instructionRefs: any;
    integer: any;
    list: any;
    need: any;
    one: any;
    optional: any;
    resolveContentRef: any;
    stableWorkbenchJson: any;
    strictObject: any;
    validContentRef: any;
    validateReferenceSelection: any;
}): {
    operations: {
        'activation.prepare': {
            question: (x: any) => boolean;
            seeds: (x: any) => boolean;
            pool: (x: any) => boolean;
            excluded: (x: any) => boolean;
            instructions: any;
            limit: (x: any) => boolean;
            canvasId: (x: any) => boolean;
            id: any;
            at: (x: any) => boolean;
        };
        'activation.result': {
            id: any;
            expectedVersion: any;
            source: (x: any) => any;
            summary: (x: any) => boolean;
            candidates: any;
            coverage: (x: any) => any;
            at: (x: any) => boolean;
        };
        'activation.decide': {
            id: any;
            expectedVersion: any;
            candidateId: any;
            decision: any;
            interpretation: (x: any) => any;
            note: (x: any) => boolean;
            output: any;
            at: (x: any) => boolean;
        };
        'activation.close': {
            id: any;
            expectedVersion: any;
            reason: (x: any) => boolean;
            at: (x: any) => boolean;
        };
        'activation.place.prepare': {
            canvasId: (x: any) => boolean;
            groupId: any;
            fromNodeId: any;
            toNodeId: any;
            id: any;
            expectedVersion: any;
            candidateId: any;
            at: (x: any) => boolean;
        };
        'activation.place.confirm': {
            id: any;
            expectedVersion: any;
            candidateId: any;
            revision: (x: any) => boolean;
            at: (x: any) => boolean;
        };
        'activation.place.abandon': {
            id: any;
            expectedVersion: any;
            candidateId: any;
            at: (x: any) => boolean;
        };
    };
    validate: (host: any) => void;
    apply: (host: any, op: any, { add, assertVersion, proofs, placements }: {
        add: any;
        assertVersion: any;
        placements?: {};
        proofs?: {};
    }) => void;
    input: (host: any, id: any) => {
        kind: string;
        activationId: any;
        activation: {
            [k: string]: any;
        };
        task: {
            id: string;
            title: any;
            goal: any;
            refs: any[];
            excluded: any;
            instructions: any;
            status: string;
        };
        fragments: any[];
    };
    scope: (r: any) => {
        [k: string]: any;
    };
    referenceText: (host: any, r: any) => any;
    parseOutput: (payload: any, result: any, provided: any) => {
        summary: any;
        candidates: any;
        coverage: {
            read: any[];
            partial: any[];
            unread: any[];
        };
    };
    candidate: (x: any) => any;
    explanation: (x: any) => any;
    verifyLayout: (host: any, canvasId: any, command: any) => void;
    needsProof: (op: any) => boolean;
};
