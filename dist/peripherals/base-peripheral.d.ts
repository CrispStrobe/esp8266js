import { IMemory } from '../core/memory';
import { ESP8266 } from '../esp8266';
export declare const PeripheralBlockSize = 4096;
export interface IPeripheral extends IMemory {
    name: string;
    baseAddr: number;
    reset(): void;
}
export declare class BasePeripheral implements IPeripheral {
    protected readonly esp: ESP8266;
    readonly baseAddr: number;
    readonly name: string;
    protected readonly memory: Uint8Array;
    protected readonly memoryView: DataView;
    constructor(esp: ESP8266, baseAddr: number, name: string);
    readUint8(addr: number): number;
    readUint16(addr: number): number;
    readUint32(addr: number): number;
    writeUint8(addr: number, value: number): void;
    writeUint16(addr: number, value: number): void;
    writeUint32(addr: number, value: number): void;
    reset(): void;
    protected readRegister(offset: number): number;
    protected writeRegister(offset: number, value: number): void;
    protected setRegisterBits(offset: number, mask: number): number;
    protected clearRegisterBits(offset: number, mask: number): number;
}
export declare class UnimplementedPeripheral extends BasePeripheral {
}
