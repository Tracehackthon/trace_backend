export declare const CAPABILITY_PACKET_MIME = "application/vnd.trace.capability";
export declare const CAPABILITY_PACKET_LIMIT: number;
export declare function parseCapabilityPacket(bytes: any): {
    manifest: any;
    assets: any;
};
export declare function decodeCapabilityPacket(file: any): Promise<{
    manifest: any;
    assets: any;
    bytes: Uint8Array<any>;
    sha256: string;
}>;
export declare function encodeCapabilityPacket(manifest: any, readOriginal: any): Promise<Blob>;
export declare function assertCapabilityPacketOperation(op: any, bytes: any, hash: any): {
    manifest: any;
    assets: any;
};
