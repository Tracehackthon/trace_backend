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
declare const resource: (x: any) => boolean;
export declare const validResourceDescriptor: typeof resource;
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
export declare const isWorkbenchOperation: (x: any) => boolean;
export declare function validateWorkbenchOperation(op: any): any;
export declare function emptyWorkbench(): {
    schemaVersion: number;
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
export declare function resolveContentRef(host: any, ref: any, { forUse }?: {
    forUse?: boolean;
}): {
    item: any;
    value: any;
};
export declare function migrateWorkbench(previous: any): any;
export declare function projectLegacyWorkbench(host: any): any;
export declare function validateWorkbench(host: any): any;
export declare function applyWorkbenchOperations(previous: any, ops: any, { feedbackEvidence }?: {
    feedbackEvidence?: {};
}): any;
export {};
