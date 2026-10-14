import { ClockEventCallback, IClockEvent } from './clock';
import { SimulationClock } from './simulation-clock';
export declare class ClockEvent implements IClockEvent {
    private readonly clock;
    readonly callback: ClockEventCallback;
    constructor(clock: SimulationClock, callback: ClockEventCallback);
    schedule(deltaNanos: number): void;
    unschedule(): void;
}
