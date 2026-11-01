export declare class ProductCommandError extends Error {
    code: any;
    status: number;
    constructor(code: any, message: any, status?: number);
}
export declare function validateProductOperations(operations: any): any;
export declare function validateProductCommand(command: any): any;
export declare function applyProductOperations(previous: any, operations: any, options?: {}): any;
