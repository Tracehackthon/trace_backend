/** Pure, session-only chain state. Handoff snapshots are historical context,
 * not delivery evidence; current delivery belongs to worksite.connection. */
export declare const SCREENS: readonly string[];
export declare function createChainState(options?: {}): {
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
export declare function reduceChain(previous: any, action?: {}): any;
export declare function selectChainView(state: any): any;
/** Explicit preview fixture only. Never called by NAVIGATE or user mutations. */
export declare function createChainDemo(screen?: string): any;
