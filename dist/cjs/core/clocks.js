"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266Clocks = exports.MHz = void 0;
const frequency_clock_1 = require("../clock/frequency-clock");
exports.MHz = 1000000;
class ESP8266Clocks {
    constructor(rootClock) {
        this.cpuFreq = 160 * exports.MHz;
        this.apbFreq = 80 * exports.MHz;
        this.xtalFreq = 40 * exports.MHz;
        this.rtc8mFreq = 8 * exports.MHz;
        this.refFreq = this.apbFreq;
        this.cpuClockPeriod = 0;
        this.cpuClockSource = 0;
        this.apb = new frequency_clock_1.FrequencyClock(rootClock, this.apbFreq);
        this.cpu = new frequency_clock_1.FrequencyClock(rootClock, this.cpuFreq);
    }
}
exports.ESP8266Clocks = ESP8266Clocks;
//# sourceMappingURL=clocks.js.map