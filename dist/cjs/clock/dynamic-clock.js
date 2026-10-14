"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DyanmicClock = void 0;
const dynamic_clock_event_1 = require("./dynamic-clock-event");
class DyanmicClock {
    constructor(rootClock, frequencyValue) {
        this.rootClock = rootClock;
        this.frequencyValue = frequencyValue;
        this.listeners = new Set();
        this.baseTicks = 0;
        this.baseNanos = 0;
    }
    get ticks() {
        const { baseTicks, baseNanos } = this;
        return ((this.rootClock.nanos - baseNanos) / 1e9) * this.frequency + baseTicks;
    }
    setFrequency(frequency) {
        const oldFrequency = this.frequencyValue;
        if (frequency !== oldFrequency) {
            this.baseTicks = this.ticks;
            this.baseNanos = this.rootClock.nanos;
            this.frequencyValue = frequency;
            for (const listener of this.listeners) {
                listener(this.frequencyValue, oldFrequency);
            }
        }
    }
    get frequency() {
        return this.frequencyValue;
    }
    createEvent(callback) {
        return new dynamic_clock_event_1.DynamicClockEvent(this, callback);
    }
    addFrequencyListener(listener) {
        this.listeners.add(listener);
    }
    removeFrequencyListener(listener) {
        this.listeners.delete(listener);
    }
}
exports.DyanmicClock = DyanmicClock;
//# sourceMappingURL=dynamic-clock.js.map