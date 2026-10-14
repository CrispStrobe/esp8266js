import { IDynamicClock } from './clock';
import { DyanmicClock } from './dynamic-clock';
export declare class DerivedClock extends DyanmicClock {
    private parentClock;
    private multiplierValue;
    constructor(parentClock: IDynamicClock, multiplierValue: number);
    private update;
    get multiplier(): number;
    set multiplier(value: number);
    get divider(): number;
    set divider(value: number);
    get parent(): IDynamicClock;
    set parent(parent: IDynamicClock);
}
