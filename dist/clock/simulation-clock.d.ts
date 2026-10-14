import { ClockEventCallback, IClock } from './clock';
import { ClockEvent } from './clock-event';
export interface ISimulationClock extends IClock {
    readonly nanos: number;
    skipToNextEvent(deadline: number): void;
    /** @deprecated use createEvent() instead */
    schedule(callback: ClockEventCallback, ns: number): ClockEventCallback;
    /** @deprecated use createEvent() instead */
    unschedule(callback: ClockEventCallback): boolean;
}
export declare class SimulationClock implements ISimulationClock {
    readonly frequency: number;
    cpu: {
        cycles: number;
    };
    private nextClockEvent;
    private readonly clockEventPool;
    constructor(frequency?: number, cpu?: {
        cycles: number;
    });
    get micros(): number;
    get millis(): number;
    get nanos(): number;
    get ticks(): number;
    createEvent(callback: ClockEventCallback): ClockEvent;
    schedule(callback: ClockEventCallback, nanos: number): ClockEventCallback;
    unschedule(callback: ClockEventCallback): boolean;
    addEventCycles(callback: ClockEventCallback, cycles: number): ClockEventCallback;
    tick(): void;
    skipToNextEvent(deadline?: number): void;
    get nextClockEventCycles(): number;
}
