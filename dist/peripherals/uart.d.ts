import { ESP8266 } from '../esp8266';
import { BasePeripheral } from './base-peripheral';
export declare enum UARTTxState {
    TX_IDLE = 0,
    TX_STRT = 1,
    TX_DAT0 = 2,
    TX_DAT1 = 3,
    TX_DAT2 = 4,
    TX_DAT3 = 5,
    TX_DAT4 = 6,
    TX_DAT5 = 7,
    TX_DAT6 = 8,
    TX_DAT7 = 9,
    TX_PRTY = 10,
    TX_STP1 = 11,
    TX_STP2 = 12,
    TX_DL0 = 13,
    TX_DL1 = 14
}
export type UartTXCallback = (value: number) => void;
export type UartConfigurationUpdatedCallback = (uart: ESP8266UART) => void;
export declare class ESP8266UART extends BasePeripheral {
    readonly index: number;
    readonly irq: number;
    private readonly rxFIFO;
    private readonly txFIFO;
    rxFullThreshold: number;
    txEmptyThreshold: number;
    txState: UARTTxState;
    baudRate: number;
    dataReceived: boolean;
    onTX: UartTXCallback;
    onConfigurationUpdated: UartConfigurationUpdatedCallback;
    constructor(esp: ESP8266, baseAddr: number, name: string, index: number, irq: number);
    get intStatus(): number;
    private checkInterrupt;
    private getClock;
    private updateBaudRate;
    get txBusy(): boolean;
    private txUpdated;
    txComplete(): void;
    feedByte(value: number): boolean;
    get bitNum(): 5 | 6 | 7 | 8;
    readUint8(addr: number): number;
    readUint16(addr: number): number;
    readUint32(addr: number): number;
    writeUint8(addr: number, value: number): void;
    writeUint32(addr: number, value: number): void;
    reset(): void;
}
