export interface IMemory {
    readUint8(addr: number): number;
    readUint16(addr: number): number;
    readUint32(addr: number): number;
    writeUint8(addr: number, value: number): void;
    writeUint16(addr: number, value: number): void;
    writeUint32(addr: number, value: number): void;
}
export declare class Memory implements IMemory {
    readonly data: Uint8Array;
    private base;
    constructor(data: Uint8Array, base: number);
    get baseAddr(): number;
    contains(addr: number): boolean;
    readUint8(addr: number): number;
    readUint16(addr: number): number;
    readUint32(addr: number): number;
    writeUint8(addr: number, value: number): void;
    writeUint16(addr: number, value: number): void;
    writeUint32(addr: number, value: number): void;
    set(array: ArrayLike<number>, addr: number): void;
    createView(baseAddr: number, offset: number, size: number): Memory;
    remap(newBase: number): Memory;
}
export declare class ReadonlyMemory extends Memory {
    static override: boolean;
    writeUint8(addr: number, value: number): void;
    writeUint16(addr: number, value: number): void;
    writeUint32(addr: number, value: number): void;
    createView(baseAddr: number, offset: number, size: number): ReadonlyMemory;
}
export declare class InvalidMemory implements IMemory {
    private defaultValue;
    constructor(defaultValue?: number);
    readUint8(): number;
    readUint16(): number;
    readUint32(): number;
    writeUint8(): void;
    writeUint16(): void;
    writeUint32(): void;
}
