export declare class WorkbenchError extends Error {
    code: any;
    status: number;
    constructor(code: any, message: any, status?: number);
}
export declare const demandWorkbench: (condition: any, code: any, message: any, status: any) => void;
export declare const plainObject: (x: any) => boolean;
export declare const stableWorkbenchJson: (x: any) => any;
export declare const strictObject: (x: any, fields: any) => boolean;
export declare const validContentRef: (x: any) => boolean;
export declare const validCanvasContentRef: (x: any) => boolean;
export declare function freezeCanvasContentRef(host: any, ref: any): any;
export declare const validMessageScope: (x: any) => boolean;
export declare function contentReferencesOverlap(a: any, b: any): boolean;
export declare function effectiveContentReferences(included: any, excluded?: any[]): any;
export declare function validateMessageScope(host: any, scope: any, session: any, before?: any, { forUse }?: {
    forUse?: boolean;
}): any;
declare const resource: (x: any) => boolean;
export declare const validResourceDescriptor: typeof resource;
export declare function projectThinkingMessageSource(host: any, value: any): {
    status: string;
    reason?: undefined;
    text?: undefined;
    locator?: undefined;
    sessionId?: undefined;
    messageId?: undefined;
    title?: undefined;
} | {
    status: string;
    reason: string;
    text?: undefined;
    locator?: undefined;
    sessionId?: undefined;
    messageId?: undefined;
    title?: undefined;
} | {
    reason?: undefined;
    status: string;
    text: any;
    locator: any;
    sessionId: any;
    messageId: any;
    title: any;
};
export declare function prepareThinkingMessageCapture(host: any, { id, sessionId, messageId, selection, title }: {
    id: any;
    messageId: any;
    selection: any;
    sessionId: any;
    title: any;
}): {
    operation: {
        type: string;
        id: any;
        kind: string;
        title: any;
        value: {
            text: any;
            resourceId: any;
            origin: {
                kind: string;
                message: {
                    sessionId: any;
                    messageId: any;
                };
                locator: any;
            };
        };
    };
    source: {
        kind: string;
        id: any;
        version: number;
    };
    excerpt: any;
};
export declare const validateCapabilityPacket: (manifest: any) => any;
export declare const prepareCapabilityPacket: (host: any, { ref: chosen, packetId, createdAt, sender, recipient, sourceRefs, originalIds, omittedFields }: {
    createdAt: any;
    omittedFields?: any[];
    originalIds?: any[];
    packetId: any;
    recipient: any;
    ref: any;
    sender: any;
    sourceRefs?: any[];
}) => any;
export declare const findReceivedCapabilityPacket: (host: any, packetResourceId: any) => any;
export declare const validCapabilityFeedbackInput: (x: any) => boolean;
export declare const capabilityFeedbackNeedsProof: (op: any, host: any) => boolean;
export declare const feedbackContextReferences: (host: any, source: any) => any;
export declare const capabilityFeedbackInputContext: (source: any) => any;
export declare const activationNeedsProof: (op: any) => boolean;
export declare const activationInput: (host: any, id: any) => {
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
export declare const activationReferenceText: (host: any, r: any) => any;
export declare const validActivationCandidate: (x: any) => any;
export declare const validActivationExplanation: (x: any) => any;
export declare const verifyActivationLayout: (host: any, canvasId: any, command: any) => void;
export declare const parseActivationOutput: (payload: any, result: any, provided: any) => {
    summary: any;
    candidates: any;
    coverage: {
        read: any[];
        partial: any[];
        unread: any[];
    };
};
export declare const isWorkbenchOperation: (x: any) => boolean;
export declare function validateWorkbenchOperation(op: any): any;
export declare function emptyWorkbench(): {
    schemaVersion: number;
    activations: {};
    feedbacks: {};
    resources: {};
    materials: {};
    expressions: {};
    relations: {};
    capabilities: {};
    sessions: {};
    tasks: {};
    legacy: any;
    migration: {
        version: number;
        matterRefs: {};
        sourceRefs: {};
    };
};
export declare function validateReferenceSelection(host: any, ref: any): {
    item: any;
    value: any;
};
export declare function resolveContentRef(host: any, ref: any, { forUse }?: {
    forUse?: boolean;
}): {
    item: any;
    value: any;
};
export declare function taskInput(host: any, id: any, { forUse }?: {
    forUse?: boolean;
}): {
    task: {
        [k: string]: any;
    };
    fragments: any[];
};
export declare function migrateWorkbench(previous: any): any;
export declare function projectLegacyWorkbench(host: any): any;
export declare function validateWorkbench(host: any): any;
export declare function applyWorkbenchOperations(previous: any, ops: any, { feedbackEvidence, activationEvidence, activationPlacements, taskDispatchEvidence }?: {
    activationEvidence?: {};
    activationPlacements?: {};
    feedbackEvidence?: {};
    taskDispatchEvidence?: {};
}): any;
export {};
