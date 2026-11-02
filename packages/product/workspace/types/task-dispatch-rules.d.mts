export declare function createTaskDispatchRules({ need, strictObject, identity, integer, one, optional, list }: {
    identity: any;
    integer: any;
    list: any;
    need: any;
    one: any;
    optional: any;
    strictObject: any;
}): {
    record: (x: any) => any;
    history: (x: any) => boolean;
    state: (task: any) => boolean;
    operations: {
        'task.dispatch.reserve': {
            id: any;
            commandId: any;
            source: any;
            requestId: any;
            runId: any;
            inputVersion: any;
            inputHash: (x: any) => boolean;
            preparedInputHash: (x: any) => boolean;
            projectDir: (x: any) => boolean;
            projectIdentity: (x: any) => boolean;
            mode: any;
            at: (x: any) => boolean;
            taskId: any;
            inputCommandId: any;
            previousRunId: (x: any) => any;
        };
        'task.dispatch.cancel': {
            taskId: any;
            dispatchId: any;
            at: (x: any) => boolean;
        };
    };
    apply: (host: any, op: any, proofs: any) => void;
};
