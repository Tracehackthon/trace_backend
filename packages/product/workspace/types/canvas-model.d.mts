export declare const emptyCanvas: (canvasId: any, title?: string) => {
    schemaVersion: number;
    id: any;
    title: string;
    revision: number;
    nodes: any[];
    connections: any[];
    undo: any[];
    redo: any[];
};
export declare function validateCanvasScene(scene: any): any;
export declare function validateCanvasDocument(document: any): any;
export declare function validateCanvasCommand(command: any): any;
export declare function applyCanvasCommand(previous: any, command: any): any;
export declare function canvasCommandFingerprint(command: any): any;
