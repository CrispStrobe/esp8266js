"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrequencyClock = void 0;
const dynamic_clock_1 = require("./dynamic-clock");
class FrequencyClock extends dynamic_clock_1.DyanmicClock {
    get frequency() {
        return this.frequencyValue;
    }
    set frequency(frequency) {
        this.setFrequency(frequency);
    }
}
exports.FrequencyClock = FrequencyClock;
//# sourceMappingURL=frequency-clock.js.map