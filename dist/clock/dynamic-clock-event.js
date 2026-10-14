export class DynamicClockEvent {
    constructor(clock, callback) {
        this.clock = clock;
        this.rootClock = this.clock.rootClock;
        this.rootEvent = this.rootClock.createEvent(callback);
    }
    schedule(deltaTicks) {
        const deltaNanos = (deltaTicks * 1e9) / this.clock.frequency;
        this.rootEvent.schedule(deltaNanos);
        // TODO should be able to update target time if the target clock frequency changes
    }
    unschedule() {
        this.rootEvent.unschedule();
    }
}
//# sourceMappingURL=dynamic-clock-event.js.map