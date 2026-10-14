import { BasePeripheral } from './base-peripheral';
export declare class ESP8266WDev extends BasePeripheral {
    protected readonly memory: Uint8Array;
    protected readonly memoryView: DataView;
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
}
