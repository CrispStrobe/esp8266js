import { ClockEventCallback, IClock, IClockEvent, IDynamicClock } from './clock';
export declare class DynamicClockEvent implements IClockEvent {
    private clock;
    readonly rootClock: IClock;
    private readonly rootEvent;
    constructor(clock: IDynamicClock, callback: ClockEventCallback);
    schedule(deltaTicks: number): void;
    unschedule(): void;
}
