import { ISimulationClock } from './clock/simulation-clock';
import { ESP8266Clocks } from './core/clocks';
import { LX106Core } from './core/lx106-core';
import { IMemory, InvalidMemory, Memory, ReadonlyMemory } from './core/memory';
import { IPeripheral } from './peripherals/base-peripheral';
import { NetWorld } from './net/world';
import { BWNet } from './peripherals/bwnet';
import { ESP8266GPIO } from './peripherals/gpio';
import { ESP8266SPI } from './peripherals/spi';
import { ESP8266UART } from './peripherals/uart';
export interface IESP8266Config {
    clock?: ISimulationClock;
    flashSizeMB?: 1 | 2 | 4 | 8;
    /** The simulated Wi-Fi world this board's network device (BWNet) can join, and its address. */
    net?: {
        world: NetWorld;
        mac?: Uint8Array;
    };
}
export declare class ESP8266 {
    readonly config: IESP8266Config;
    readonly flash: Uint8Array;
    readonly flashMemory: ReadonlyMemory;
    readonly chipROM: ReadonlyMemory;
    readonly rom1: ReadonlyMemory;
    readonly iram: Memory;
    readonly dataMem: Memory;
    readonly rtcSlowMem: Memory;
    readonly invalidMem: InvalidMemory;
    readonly dmaBase: number;
    readonly peripherals: IPeripheral[];
    readonly peripheralMap: {
        [addr: number]: IMemory;
    };
    readonly uart: ESP8266UART[];
    readonly spi: ESP8266SPI[];
    readonly gpio: ESP8266GPIO;
    /** The simulator's own network device; not ESP8266 hardware (see peripherals/bwnet.ts). */
    readonly net: BWNet;
    resetReason: number;
    onReset: () => boolean;
    onAnalogRead: () => number;
    readonly cores: LX106Core[];
    readonly clock: ISimulationClock;
    readonly clocks: ESP8266Clocks;
    cycles: number;
    stopped: boolean;
    onBreak: (core: LX106Core) => void | null;
    readonly writeWatchPoints: Set<number>;
    lastMappedAddress: number;
    constructor(config?: IESP8266Config);
    loadROM(binary: Uint8Array): void;
    reset(): void;
    mapAddress(addr: number): IMemory;
    step(): void;
    get coresIdle(): boolean;
    get refNanos(): number;
    interrupt(index: number, set?: boolean): void;
    get apbNanos(): number;
    get devices(): {
        nonvolatile: {
            flash: Uint8Array;
        };
        volatile: {
            iram: Uint8Array;
            dram: Uint8Array;
            rtc: Uint8Array;
        };
    };
}
