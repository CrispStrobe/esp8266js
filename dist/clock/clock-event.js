export class ClockEvent {
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
//# sourceMappingURL=clock-event.js.map