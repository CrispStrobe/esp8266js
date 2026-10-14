import { ESP8266 } from '../esp8266';
import { BasePeripheral } from './base-peripheral';
export declare enum IOPinState {
    Low = 0,
    High = 1,
    Input = 2,
    PullUp = 3,
    PullDown = 4
}
declare enum IntType {
    Disable = 0,
    RisingEdge = 1,
    FallingEdge = 2,
    Edge = 3,
    LowLevel = 4,
    HighLevel = 5
}
export type IOPinListener = (newState: IOPinState, oldState: IOPinState) => void;
export declare class IOPin {
    readonly gpio: ESP8266GPIO;
    readonly id: number;
    private listeners;
    private intType;
    private outputEnableValue;
    state: IOPinState;
    openDrain: boolean;
    internalPullDown: boolean;
    internalPullUp: boolean;
    muxFunction: number;
    rtcPullDown: boolean;
    rtcPullUp: boolean;
    gpioOutput: boolean;
    gpioOutputEnable: boolean;
    get outputEnable(): boolean;
    matrixEnable: boolean;
    matrixSelectOutputEnable: boolean;
    matrixOutputEnableInvert: boolean;
    matrixOutputInvert: boolean;
    matrixOutput: boolean;
    matrixOutputEnable: boolean;
    readonly bank: number;
    constructor(gpio: ESP8266GPIO, id: number);
    reset(): void;
    get inputValue(): boolean;
    set inputValue(value: boolean);
    internalUpdateState(newState: IOPinState): void;
    internalSetInterrupt(intType: IntType): void;
    update(): void;
    addListener(listener: IOPinListener): () => boolean;
}
export declare class ESP8266GPIO extends BasePeripheral {
    readonly esp: ESP8266;
    readonly irq: number;
    readonly pins: IOPin[];
    inputValues: number[];
    intStatus: number[];
    proIntEnable: number[];
    proNMIIntEnable: number[];
    constructor(esp: ESP8266, baseAddr: number, name: string, irq: number);
    updateGPIO(): void;
    setBoot(): void;
    captureStrap(): void;
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
    interruptsUpdated(): void;
    reset(): void;
}
export {};
