import { ClockEventCallback, ClockFrequencyListener, IClockEvent, IDynamicClock } from './clock';
import { ISimulationClock } from './simulation-clock';
export declare abstract class DyanmicClock implements IDynamicClock {
    readonly rootClock: ISimulationClock;
    protected frequencyValue: number;
    protected readonly listeners: Set<ClockFrequencyListener>;
    protected baseTicks: number;
    protected baseNanos: number;
    constructor(rootClock: ISimulationClock, frequencyValue: number);
    get ticks(): number;
    protected setFrequency(frequency: number): void;
    get frequency(): number;
    createEvent(callback: ClockEventCallback): IClockEvent;
    addFrequencyListener(listener: ClockFrequencyListener): void;
    removeFrequencyListener(listener: ClockFrequencyListener): void;
}
