import { BasePeripheral, IPeripheral } from './base-peripheral';
export declare class ESP8266RTC extends BasePeripheral implements IPeripheral {
    readUint32(addr: number): number;
}
