"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClockEvent = void 0;
class ClockEvent {
    constructor(clock, callback) {
        this.clock = clock;
        this.callback = callback;
    }
    schedule(deltaNanos) {
        this.unschedule();
        this.clock.schedule(this.callback, deltaNanos);
    }
    unschedule() {
        this.clock.unschedule(this.callback);
    }
}
exports.ClockEvent = ClockEvent;
//# sourceMappingURL=clock-event.js.map