export declare function createCapabilityFeedbackRules(v: any): {
    input: (x: any) => boolean;
    value: (x: any) => boolean;
    context: (x: any) => any;
    inputContext: (source: any) => any;
    sourceRefs: (host: any, source: any) => any;
    requiresProof: (op: any, host: any) => boolean;
    apply: (host: any, op: any, { versioned, add, assertVersion, checkRefs, proofs }: {
        add: any;
        assertVersion: any;
        checkRefs: any;
        proofs?: {};
        versioned: any;
    }) => void;
    change: (c: any) => any;
    validate: (host: any) => void;
};
