export declare function createCapabilityPacketRules(v: any): {
    validate: (manifest: any) => any;
    validManifest: (x: any) => any;
    prepare: (host: any, { ref: chosen, packetId, createdAt, sender, recipient, sourceRefs, originalIds, omittedFields }: {
        createdAt: any;
        omittedFields?: any[];
        originalIds?: any[];
        packetId: any;
        recipient: any;
        ref: any;
        sender: any;
        sourceRefs?: any[];
    }) => any;
    change: (c: any) => boolean;
    received: (host: any, packetResourceId: any) => any;
    applyExport: (host: any, op: any) => void;
    applyReceive: (host: any, op: any, { versioned, add, assertVersion }: {
        add: any;
        assertVersion: any;
        versioned: any;
    }) => void;
};
