import { ESP8266 } from '../esp8266';
import { BasePeripheral } from './base-peripheral';
import { ESP8266GPIO } from './gpio';
export declare class ESP8266IOMUX extends BasePeripheral {
    readonly gpio: ESP8266GPIO;
    constructor(esp: ESP8266, baseAddr: number, name: string, gpio: ESP8266GPIO);
    writeUint32(addr: number, value: number): void;
    reset(): void;
}
