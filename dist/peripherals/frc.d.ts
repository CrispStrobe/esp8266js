import { ESP8266 } from '../esp8266';
import { BasePeripheral } from './base-peripheral';
declare class FRCTimer {
    private esp;
    readonly index: number;
    readonly irq: number;
    private baseValue;
    private baseNanos;
    private loadReg;
    private ctrlReg;
    private alarmReg;
    private alarmScheduled;
    readonly mask: number;
    constructor(esp: ESP8266, index: number, irq: number);
    private get prescaler();
    get timerValue(): number;
    readUint32(register: number): number;
    scheduleAlarm(): void;
    onAlarm: () => void;
    updateInterrupts(): void;
    writeUint32(register: number, value: number): void;
}
/**
 * The first hardware timer (FRC1): a 23-bit DOWN counter.
 *
 * Writing LOAD sets the counter. Enabled, it counts down at the peripheral
 * clock divided by the prescaler; on reaching zero it raises its interrupt
 * (9) and either reloads LOAD (autoload) or wraps to 0x7fffff and goes on.
 * Writing 1 to INT clears the interrupt status. This is the behaviour the
 * SDK's public register header describes (FRC1_LOAD / COUNT / CTRL / INT);
 * it has not been compared with a chip.
 *
 * The interrupt is raised once per zero crossing. For the level-interrupt
 * setting (CTRL bit 0) the request is therefore not held while the status
 * stays set; firmware that acknowledges in its handler does not notice.
 */
declare class FRC1Timer {
    private esp;
    readonly irq: number;
    private loadReg;
    private ctrlReg;
    /** The counter's value at `baseNanos`. */
    private baseValue;
    private baseNanos;
    private scheduled;
    constructor(esp: ESP8266, irq: number);
    private get prescaler();
    private get enabled();
    /** What a zero crossing reloads: LOAD with autoload (0 standing for a full turn), else a full turn. */
    private get period();
    private get nanosPerTick();
    private get elapsedTicks();
    get value(): number;
    /** Fix the counter at its present value and time; called before anything that changes its rate. */
    private rebase;
    private schedule;
    private onZero;
    readUint32(register: number): number;
    writeUint32(register: number, value: number): void;
}
export declare class ESPFRC extends BasePeripheral {
    readonly timers: (FRCTimer | FRC1Timer)[];
    constructor(esp: ESP8266, baseAddr: number, name: string, timer2Irq: number, timer1Irq?: number);
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
    reset(): void;
}
export {};
