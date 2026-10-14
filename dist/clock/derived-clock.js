import { DyanmicClock } from './dynamic-clock';
export class DerivedClock extends DyanmicClock {
    constructor(parentClock, multiplierValue) {
        super(parentClock.rootClock, parentClock.frequency * multiplierValue);
        this.parentClock = parentClock;
        this.multiplierValue = multiplierValue;
        this.update = () => {
            const oldFrequency = this.frequencyValue;
            const frequency = this.parentClock.frequency * this.multiplierValue;
            if (frequency !== oldFrequency) {
                this.setFrequency(frequency);
            }
        };
        parentClock.addFrequencyListener(this.update);
    }
    get multiplier() {
        return this.multiplierValue;
    }
    set multiplier(value) {
        this.multiplierValue = value;
        this.update();
    }
    get divider() {
        return this.multiplierValue ? 1 / this.multiplierValue : 0;
    }
    set divider(value) {
        this.multiplierValue = value ? 1 / value : 0;
        this.update();
    }
    get parent() {
        return this.parentClock;
    }
    set parent(parent) {
        if (parent !== this.parentClock) {
            this.parentClock.removeFrequencyListener(this.update);
            this.parentClock = parent;
            parent.addFrequencyListener(this.update);
            this.update();
        }
    }
}
//# sourceMappingURL=derived-clock.js.map