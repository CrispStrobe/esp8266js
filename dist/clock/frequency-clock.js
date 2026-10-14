import { DyanmicClock } from './dynamic-clock';
export class FrequencyClock extends DyanmicClock {
    get frequency() {
        return this.frequencyValue;
    }
    set frequency(frequency) {
        this.setFrequency(frequency);
    }
}
//# sourceMappingURL=frequency-clock.js.map