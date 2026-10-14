"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESPFRC = void 0;
const base_peripheral_1 = require("./base-peripheral");
const FRC_TIMER_LOAD_REG = 0x0;
const FRC_TIMER_COUNT_REG = 0x04;
const FRC_TIMER_CTRL_REG = 0x08;
const FRC_TIMER_INT_REG = 0xc;
const FRC_TIMER_ALARM_REG = 0x10;
// FRC_TIMER_CTRL_REG bits
const FRC_TIMER_INT_STATUS = 1 << 8; // Interrupt status (RO)
const FRC_TIMER_ENABLE = 1 << 7; // Enable timer
const FRC_TIMER_AUTOLOAD = 1 << 6; // Enable autoload
const FRC_TIMER_LEVEL_INT = 1 << 0; // 1: level, 0: edge
const FRC1_MASK = 0x007fffff;
const FRC1_TURN = 0x00800000;
class FRCTimer {
    constructor(esp, index, irq) {
        this.esp = esp;
        this.index = index;
        this.irq = irq;
        this.baseValue = 0;
        this.baseNanos = 0;
        this.loadReg = 0;
        this.ctrlReg = 0;
        this.alarmReg = 0;
        this.alarmScheduled = false;
        this.mask = this.index === 0 ? 0x007fffff : 0xffffffff; // Timer 0 only has 23 bits
        this.onAlarm = () => {
            this.ctrlReg |= FRC_TIMER_INT_STATUS;
            this.alarmScheduled = false;
            if (this.ctrlReg & FRC_TIMER_AUTOLOAD) {
                this.scheduleAlarm();
            }
            this.updateInterrupts();
        };
    }
    get prescaler() {
        switch ((this.ctrlReg >> 1) & 7) {
            case 0:
                return 1;
            case 2:
                return 16;
            case 4:
                return 256;
            default:
                return 1;
        }
    }
    get timerValue() {
        return (((this.baseValue +
            (((this.esp.clock.nanos - this.baseNanos) / 1000000) * this.esp.clocks.apbFreq) /
                1000 /
                this.prescaler) &
            this.mask) >>>
            0);
    }
    readUint32(register) {
        switch (register) {
            case FRC_TIMER_LOAD_REG:
                return this.loadReg >>> 0;
            case FRC_TIMER_CTRL_REG:
                return this.ctrlReg;
            case FRC_TIMER_COUNT_REG:
                if (this.ctrlReg & FRC_TIMER_ENABLE) {
                    return this.timerValue;
                }
                else {
                    return this.baseValue;
                }
            case FRC_TIMER_ALARM_REG:
                return this.alarmReg;
        }
        return 0;
    }
    scheduleAlarm() {
        if (!(this.ctrlReg & FRC_TIMER_ENABLE) || this.index === 0) {
            return;
        }
        const ticksToAlarm = (this.alarmReg - this.timerValue) >>> 0;
        const nanosToAlarm = (ticksToAlarm * this.prescaler * 1000000000) / this.esp.clocks.apbFreq;
        if (this.alarmScheduled) {
            this.esp.clock.unschedule(this.onAlarm);
        }
        this.esp.clock.schedule(this.onAlarm, nanosToAlarm);
        this.alarmScheduled = true;
    }
    updateInterrupts() {
        const intStatus = this.ctrlReg & FRC_TIMER_INT_STATUS;
        this.esp.interrupt(this.irq, !!intStatus);
    }
    writeUint32(register, value) {
        switch (register) {
            case FRC_TIMER_LOAD_REG:
                this.loadReg = value & this.mask;
                this.baseValue = value & this.mask;
                this.baseNanos = this.esp.clock.nanos;
                this.scheduleAlarm();
                break;
            case FRC_TIMER_CTRL_REG:
                if (this.ctrlReg & FRC_TIMER_ENABLE) {
                    this.baseValue = this.timerValue;
                    this.baseNanos = this.esp.clock.nanos;
                }
                this.ctrlReg = value;
                if (value & FRC_TIMER_ENABLE) {
                    this.scheduleAlarm();
                }
                break;
            case FRC_TIMER_INT_REG:
                if (value & 0x1) {
                    this.ctrlReg &= ~FRC_TIMER_INT_STATUS;
                    this.updateInterrupts();
                }
                break;
            case FRC_TIMER_ALARM_REG:
                this.alarmReg = value;
                this.scheduleAlarm();
                break;
        }
    }
}
/**
 * The first hardware timer (FRC1): a 23-bit DOWN counter.
 *
 * Writing LOAD sets the counter. Enabled, it counts down at the peripheral
 * clock divided by the prescaler; on reaching zero it raises its interrupt
 * (9) and either reloads LOAD (autoload) or wraps to 0x7fffff and goes on.
 * Writing 1 to INT clears the interrupt status. This is the behaviour the
 * SDK's public register header describes (FRC1_LOAD / COUNT / CTRL / INT);
 * it has not been compared with a chip.
 *
 * The interrupt is raised once per zero crossing. For the level-interrupt
 * setting (CTRL bit 0) the request is therefore not held while the status
 * stays set; firmware that acknowledges in its handler does not notice.
 */
class FRC1Timer {
    constructor(esp, irq) {
        this.esp = esp;
        this.irq = irq;
        this.loadReg = 0;
        this.ctrlReg = 0;
        /** The counter's value at `baseNanos`. */
        this.baseValue = 0;
        this.baseNanos = 0;
        this.scheduled = false;
        this.onZero = () => {
            this.scheduled = false;
            // The counter is at zero now and starts its next turn.
            this.baseValue = 0;
            this.baseNanos = this.esp.clock.nanos;
            this.ctrlReg |= FRC_TIMER_INT_STATUS;
            this.esp.interrupt(this.irq, true);
            this.schedule();
        };
    }
    get prescaler() {
        switch ((this.ctrlReg >> 1) & 7) {
            case 2:
                return 16;
            case 4:
                return 256;
            default:
                return 1;
        }
    }
    get enabled() {
        return !!(this.ctrlReg & FRC_TIMER_ENABLE);
    }
    /** What a zero crossing reloads: LOAD with autoload (0 standing for a full turn), else a full turn. */
    get period() {
        return this.ctrlReg & FRC_TIMER_AUTOLOAD && this.loadReg ? this.loadReg : FRC1_TURN;
    }
    get nanosPerTick() {
        return (this.prescaler * 1e9) / this.esp.clocks.apbFreq;
    }
    get elapsedTicks() {
        return Math.floor((this.esp.clock.nanos - this.baseNanos) / this.nanosPerTick + 1e-6);
    }
    get value() {
        if (!this.enabled)
            return this.baseValue;
        const elapsed = this.elapsedTicks;
        // From baseValue down to zero, then in turns of `period`.
        const first = this.baseValue || this.period;
        if (elapsed < first)
            return first - elapsed;
        const { period } = this;
        return period - ((elapsed - first) % period);
    }
    /** Fix the counter at its present value and time; called before anything that changes its rate. */
    rebase() {
        this.baseValue = this.value;
        this.baseNanos = this.esp.clock.nanos;
    }
    schedule() {
        if (this.scheduled) {
            this.esp.clock.unschedule(this.onZero);
            this.scheduled = false;
        }
        if (!this.enabled)
            return;
        this.esp.clock.schedule(this.onZero, this.value * this.nanosPerTick);
        this.scheduled = true;
    }
    readUint32(register) {
        switch (register) {
            case FRC_TIMER_LOAD_REG:
                return this.loadReg;
            case FRC_TIMER_COUNT_REG:
                return this.value & FRC1_MASK;
            case FRC_TIMER_CTRL_REG:
                return this.ctrlReg;
            case FRC_TIMER_INT_REG:
                return this.ctrlReg & FRC_TIMER_INT_STATUS ? 1 : 0;
        }
        return 0;
    }
    writeUint32(register, value) {
        switch (register) {
            case FRC_TIMER_LOAD_REG:
                this.loadReg = value & FRC1_MASK;
                this.baseValue = this.loadReg;
                this.baseNanos = this.esp.clock.nanos;
                this.schedule();
                break;
            case FRC_TIMER_CTRL_REG:
                this.rebase();
                this.ctrlReg = (value & ~FRC_TIMER_INT_STATUS) | (this.ctrlReg & FRC_TIMER_INT_STATUS);
                this.schedule();
                break;
            case FRC_TIMER_INT_REG:
                if (value & 1) {
                    this.ctrlReg &= ~FRC_TIMER_INT_STATUS;
                    this.esp.interrupt(this.irq, false);
                }
                break;
        }
    }
}
/*
 * FRC: Free running counter
 */
class ESPFRC extends base_peripheral_1.BasePeripheral {
    // The alarm of the second timer (FRC2) is interrupt 10, ETS_FRC_TIMER2_INUM
    // in the SDK's ets_sys.h: the one the SDK's software timers attach to. The
    // first timer (FRC1) is a down counter on interrupt 9.
    constructor(esp, baseAddr, name, timer2Irq, timer1Irq = -1) {
        super(esp, baseAddr, name);
        this.timers = [new FRC1Timer(esp, timer1Irq), new FRCTimer(esp, 1, timer2Irq)];
    }
    readUint32(addr) {
        const offset = addr - this.baseAddr;
        if (offset < 0x20) {
            return this.timers[0].readUint32(offset);
        }
        else if (offset < 0x40) {
            return this.timers[1].readUint32(offset - 0x20);
        }
        return super.readUint32(addr);
    }
    writeUint32(addr, value) {
        const offset = addr - this.baseAddr;
        if (offset < 0x20) {
            this.timers[0].writeUint32(offset, value);
        }
        else if (offset < 0x40) {
            this.timers[1].writeUint32(offset - 0x20, value);
        }
        else {
            super.writeUint32(addr, value);
        }
    }
    reset() {
        super.reset();
    }
}
exports.ESPFRC = ESPFRC;
//# sourceMappingURL=frc.js.map