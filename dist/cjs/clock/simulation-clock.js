"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationClock = void 0;
const clock_event_1 = require("./clock-event");
class SimulationClock {
    constructor(frequency = 125e6, cpu = { cycles: 0 }) {
        this.frequency = frequency;
        this.cpu = cpu;
        this.nextClockEvent = null;
        this.clockEventPool = []; // helps avoid garbage collection
    }
    get micros() {
        return this.nanos / 1000;
    }
    get millis() {
        return (this.cpu.cycles / this.frequency) * 1000;
    }
    get nanos() {
        return (this.cpu.cycles / this.frequency) * 1e9;
    }
    get ticks() {
        return this.nanos;
    }
    createEvent(callback) {
        return new clock_event_1.ClockEvent(this, callback);
    }
    schedule(callback, nanos) {
        const cycles = Math.round((nanos / 1e9) * this.frequency);
        return this.addEventCycles(callback, cycles);
    }
    unschedule(callback) {
        let { nextClockEvent: clockEvent } = this;
        if (!clockEvent) {
            return false;
        }
        const { clockEventPool } = this;
        let lastItem = null;
        while (clockEvent) {
            if (clockEvent.callback === callback) {
                if (lastItem) {
                    lastItem.next = clockEvent.next;
                }
                else {
                    this.nextClockEvent = clockEvent.next;
                }
                if (clockEventPool.length < 10) {
                    clockEventPool.push(clockEvent);
                }
                return true;
            }
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
        }
        return false;
    }
    addEventCycles(callback, cycles) {
        const { clockEventPool } = this;
        cycles = this.cpu.cycles + Math.max(1, cycles);
        const maybeEntry = clockEventPool.pop();
        const entry = maybeEntry ?? { cycles, callback, next: null };
        entry.cycles = cycles;
        entry.callback = callback;
        let { nextClockEvent: clockEvent } = this;
        let lastItem = null;
        while (clockEvent && clockEvent.cycles < cycles) {
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
        }
        if (lastItem) {
            lastItem.next = entry;
            entry.next = clockEvent;
        }
        else {
            this.nextClockEvent = entry;
            entry.next = clockEvent;
        }
        return callback;
    }
    tick() {
        const { nextClockEvent } = this;
        if (nextClockEvent && nextClockEvent.cycles <= this.cpu.cycles) {
            this.nextClockEvent = nextClockEvent.next;
            if (this.clockEventPool.length < 10) {
                this.clockEventPool.push(nextClockEvent);
            }
            nextClockEvent.callback();
        }
    }
    skipToNextEvent(deadline = 0) {
        const { nextClockEvent, frequency } = this;
        if (nextClockEvent && (nextClockEvent.cycles / frequency) * 1e9 <= deadline) {
            this.cpu.cycles = nextClockEvent.cycles;
            this.nextClockEvent = nextClockEvent.next;
            if (this.clockEventPool.length < 10) {
                this.clockEventPool.push(nextClockEvent);
            }
            nextClockEvent.callback();
        }
        else if (deadline > this.nanos) {
            this.cpu.cycles = Math.round(deadline * (frequency / 1e9));
        }
    }
    get nextClockEventCycles() {
        return this.nextClockEvent?.cycles ?? 0;
    }
}
exports.SimulationClock = SimulationClock;
//# sourceMappingURL=simulation-clock.js.map