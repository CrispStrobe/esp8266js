import { FrequencyClock } from '../clock/frequency-clock';
export const MHz = 1000000;
export class ESP8266Clocks {
    constructor(rootClock) {
        this.cpuFreq = 160 * MHz;
        this.apbFreq = 80 * MHz;
        this.xtalFreq = 40 * MHz;
        this.rtc8mFreq = 8 * MHz;
        this.refFreq = this.apbFreq;
        this.cpuClockPeriod = 0;
        this.cpuClockSource = 0;
        this.apb = new FrequencyClock(rootClock, this.apbFreq);
        this.cpu = new FrequencyClock(rootClock, this.cpuFreq);
    }
}
//# sourceMappingURL=clocks.js.map