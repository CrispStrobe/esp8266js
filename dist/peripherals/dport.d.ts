import { BasePeripheral } from './base-peripheral';
export declare class ESP8266DPort extends BasePeripheral {
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
    reset(): void;
}
