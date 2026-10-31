export declare const SCREENS: readonly string[];
/** Pure, in-memory worksite reducer. Supplied IDs are preserved; connectors
 * update work.connection through the product bridge rather than this model. */
export declare function createWorksiteState(options?: {}): {
    schemaVersion: number;
    isDemo: boolean;
    selectedWorkId: any;
    works: any;
    sessions: any;
    matters: any;
    notice: string;
    sequence: number;
};
/** Each preview gets its own store. Navigation in a live session never loads a fixture. */
export declare function createWorksiteDemo(screen?: string): {
    schemaVersion: number;
    isDemo: boolean;
    selectedWorkId: any;
    works: any;
    sessions: any;
    matters: any;
    notice: string;
    sequence: number;
};
export declare function reduceWorksite(state: any, action?: {}): any;
/** Detached read model: mutating the returned view cannot mutate the store. */
export declare function selectWorksiteView(state: any): any;
