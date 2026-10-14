import { FrequencyClock } from '../clock/frequency-clock';
import { ISimulationClock } from '../clock/simulation-clock';
export declare const MHz = 1000000;
export declare class ESP8266Clocks {
    readonly apb: FrequencyClock;
    readonly cpu: FrequencyClock;
    readonly cpuFreq: number;
    readonly apbFreq: number;
    readonly xtalFreq: number;
    readonly rtc8mFreq: number;
    readonly refFreq: number;
    readonly cpuClockPeriod = 0;
    readonly cpuClockSource = 0;
    constructor(rootClock: ISimulationClock);
}
