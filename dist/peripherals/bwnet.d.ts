import { ESP8266 } from '../esp8266';
import { INetMember, NetWorld } from '../net/world';
import { BasePeripheral } from './base-peripheral';
export declare const BWNET_ID = 1651994161;
export declare class BWNet extends BasePeripheral implements INetMember {
    private world?;
    readonly mac: Uint8Array;
    private ctrl;
    private refusal;
    private ssid;
    private password;
    private readonly rx;
    private rxAt;
    private tx;
    private dropped;
    constructor(esp: ESP8266, baseAddr: number, name: string, world?: NetWorld | undefined, mac?: Uint8Array);
    /** A frame from the world. */
    deliver(frame: Uint8Array): void;
    private get joined();
    private updateInterrupt;
    reset(): void;
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
    readUint8(addr: number): number;
}
