export declare function createDemoWorkspace(): {
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
