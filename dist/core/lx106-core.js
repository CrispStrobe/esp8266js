import { ExceptionCause } from './exceptions';
import { executeInstruction } from './lx106-instructions';
import { RegisterType } from './register-type';
import { BR, CCOMPARE0, CCOUNT, DEPC, EPC1, EXCCAUSE, INTCLEAR, INTENABLE, INTSET, MEMCTL, PRID, PS, SAR, VECBASE, } from './xtensa-regs';
const KernelExceptionVector = 0x30;
const UserExceptionVector = 0x50;
const DoubleExceptionVector = 0x70;
export var CoreInterrupts;
(function (CoreInterrupts) {
    CoreInterrupts[CoreInterrupts["TIMER0"] = 6] = "TIMER0";
})(CoreInterrupts || (CoreInterrupts = {}));
export class LX106Core {
    constructor(esp, name, gdbRegisters) {
        this.esp = esp;
        this.name = name;
        this.gdbRegisters = gdbRegisters;
        this.physicalRegisters = new Uint32Array(16);
        this.specialRegisters = new Uint32Array(256);
        this.userRegisters = new Uint32Array(237);
        this.gdbRegisterCount = this.gdbRegisters.length;
        this.enabled = true;
        this.idle = false;
        this.pendingInterrupts = false;
        this.opcodeSegment = 0;
        this.ccountBase = 0;
        this.ccountBaseNanos = 0;
        this.ccompare0Callback = () => {
            this.specialRegisters[INTSET] |= 1 << CoreInterrupts.TIMER0;
            this.pendingInterrupts = true;
        };
        this.processorId = 0xabab;
        this.reset();
    }
    reset() {
        this.pendingInterrupts = false;
        this.enabled = true;
        this.idle = false;
        this.physicalRegisters.fill(0);
        this.specialRegisters.fill(0);
        this.userRegisters.fill(0);
        this.ccountBase = 0;
        this.ccountBaseNanos = 0;
        this.PC = 0x40000080;
        this.PS_WOE = 1;
        this.setAR(1, 0x3fffffff); // Initialize the stack
        this.specialRegisters[PRID] = this.processorId;
        this.specialRegisters[MEMCTL] = 1;
        this.specialRegisters[VECBASE] = 0x40000000;
        this.specialRegisters[CCOUNT] = 0x05360730;
    }
    get SAR() {
        return this.specialRegisters[SAR];
    }
    set SAR(value) {
        this.specialRegisters[SAR] = value;
    }
    get PS_INTLEVEL() {
        return this.specialRegisters[PS] & 0xf;
    }
    set PS_INTLEVEL(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xfffffff0) | (value & 0xf);
        this.updateInterrupts();
    }
    get PS_EXCM() {
        return (this.specialRegisters[PS] >> 4) & 1;
    }
    set PS_EXCM(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xffffffef) | ((value & 0x1) << 4);
        this.pendingInterrupts = true;
    }
    get PS_UM() {
        return (this.specialRegisters[PS] >> 5) & 1;
    }
    set PS_UM(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xffffffdf) | ((value & 0x1) << 5);
    }
    get PS_CRING() {
        return (this.specialRegisters[PS] >> 6) & 3;
    }
    set PS_CRING(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xffffff3f) | ((value & 0x3) << 6);
    }
    get PS_OWB() {
        return (this.specialRegisters[PS] >> 8) & 0xf;
    }
    set PS_OWB(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xfffff0ff) | ((value & 0xf) << 8);
    }
    get PS_CALLINC() {
        return (this.specialRegisters[PS] >> 16) & 0x3;
    }
    set PS_CALLINC(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xfffcffff) | ((value & 0x3) << 16);
    }
    get PS_WOE() {
        return (this.specialRegisters[PS] >> 18) & 0x1;
    }
    set PS_WOE(value) {
        this.specialRegisters[PS] = (this.specialRegisters[PS] & 0xfffbffff) | ((value & 0x1) << 18);
    }
    AR(n) {
        return this.physicalRegisters[n];
    }
    setAR(n, value) {
        this.physicalRegisters[n] = value;
    }
    BR(index) {
        return !!(this.specialRegisters[BR] & (1 << index % 16));
    }
    setBR(index, value) {
        const mask = 1 << index;
        if (value) {
            this.specialRegisters[BR] |= mask;
        }
        else {
            this.specialRegisters[BR] &= ~mask;
        }
    }
    vector(offset) {
        return this.specialRegisters[VECBASE] + offset;
    }
    exception(cause) {
        if (this.PS_EXCM) {
            this.specialRegisters[DEPC] = this.PC;
            this.nextPC = this.vector(DoubleExceptionVector);
        }
        else if (this.PS_UM) {
            this.specialRegisters[EPC1] = this.PC;
            this.nextPC = this.vector(UserExceptionVector);
        }
        else {
            this.specialRegisters[EPC1] = this.PC;
            this.nextPC = this.vector(KernelExceptionVector);
        }
        this.specialRegisters[EXCCAUSE] = cause;
        this.PS_EXCM = 1;
    }
    updateInterrupts() {
        let minLevel = Math.min(this.PS_INTLEVEL, 6);
        if (this.PS_EXCM) {
            minLevel = Math.max(minLevel, 2);
        }
        const pendingInterrupts = this.specialRegisters[INTSET] & this.specialRegisters[INTENABLE];
        if (pendingInterrupts && !minLevel) {
            this.idle = false;
            this.exception(ExceptionCause.Level1Interrupt);
            this.PC = this.nextPC;
            this.pendingInterrupts = true;
            return;
        }
        this.pendingInterrupts = false;
    }
    dumpRegisters(indent = '') {
        for (let i = 0; i < 16; i++) {
            console.log(`[${this.name}]`, indent +
                `${i < 10 ? ' ' : ''}${i} AR[${i}]: ${this.AR(i).toString(16)} ${this.physicalRegisters[i].toString(16)}`);
        }
    }
    unimplemented(opcode, name) {
        console.error(`[${this.name}] UNIMPLEMENTED @${this.PC.toString(16)} ${opcode.toString(16)} ${name}`);
    }
    // CCOUNT / CCOMPARE mechanism
    get CCOUNT() {
        return ((((this.esp.clock.nanos - this.ccountBaseNanos) * this.esp.clocks.cpuFreq) / 1000000000 +
            this.ccountBase) >>>
            0);
    }
    ccompareUpdate(value, interruptIndex, callback) {
        const pendingInterrupt = this.specialRegisters[INTSET] & (1 << interruptIndex);
        this.specialRegisters[INTSET] &= ~(1 << interruptIndex);
        if (!pendingInterrupt) {
            this.esp.clock.unschedule(callback);
        }
        const delta = value === this.CCOUNT ? 0xffffffff : (value - this.CCOUNT) >>> 0;
        this.esp.clock.schedule(callback, (delta * 1e9) / this.esp.clocks.cpuFreq);
    }
    readUint8(addr) {
        return this.esp.mapAddress(addr).readUint8(addr);
    }
    readUint16(addr) {
        return this.esp.mapAddress(addr).readUint16(addr);
    }
    readUint32(addr) {
        return this.esp.mapAddress(addr).readUint32(addr);
    }
    writeUint8(addr, value) {
        if (this.esp.writeWatchPoints.has(addr)) {
            this.esp.onBreak?.(this);
        }
        this.esp.mapAddress(addr).writeUint8(addr, value);
    }
    writeUint16(addr, value) {
        if (this.esp.writeWatchPoints.has(addr)) {
            this.esp.onBreak?.(this);
        }
        this.esp.mapAddress(addr).writeUint16(addr, value);
    }
    writeUint32(addr, value) {
        if (this.esp.writeWatchPoints.has(addr)) {
            this.esp.onBreak?.(this);
        }
        this.esp.mapAddress(addr).writeUint32(addr, value);
    }
    readSpecialRegister(sr) {
        switch (sr) {
            case CCOUNT:
                return this.CCOUNT;
            default:
                return this.specialRegisters[sr];
        }
    }
    writeSpecialRegister(sr, value) {
        switch (sr) {
            case PS:
                this.pendingInterrupts = true;
                break;
            case CCOUNT:
                this.ccountBaseNanos = this.esp.clock.nanos;
                this.ccountBase = value;
                break;
            case CCOMPARE0:
                this.ccompareUpdate(value, CoreInterrupts.TIMER0, this.ccompare0Callback);
                break;
            case INTSET:
                this.specialRegisters[INTSET] |= value & 0x20000080;
                return;
            case INTCLEAR:
                this.specialRegisters[INTSET] &= ~value;
                return;
        }
        this.specialRegisters[sr] = value;
    }
    unknownInstruction(opcode) {
        console.error(`[${this.name}] ${this.PC.toString(16)}: ${opcode.toString(16)} UNKNOWN INSTRUCTION`);
        this.enabled = false;
    }
    runInstruction() {
        if (!this.enabled) {
            return;
        }
        if (this.pendingInterrupts) {
            this.nextPC = this.PC;
            this.updateInterrupts();
            this.PC = this.nextPC;
        }
        if (this.idle) {
            return;
        }
        const { breakpoints } = this;
        if (breakpoints) {
            if (breakpoints[this.PC]?.(this)) {
                return;
            }
        }
        const { PC, opcodeSegment } = this;
        let { opcodeMemory } = this;
        if (opcodeSegment !== (PC & ~0x1fff)) {
            opcodeMemory = this.opcodeMemory = this.esp.mapAddress(PC);
            this.opcodeSegment = PC & ~0x1fff;
        }
        let opcode = opcodeMemory.readUint16(PC);
        const size = (opcode & 0xc) === 0x8 || ((opcode & 0xc) === 0xc && (opcode & 0x2) === 0) ? 2 : 3;
        if (size === 3) {
            opcode |= opcodeMemory.readUint8(PC + 2) << 16;
        }
        this.nextPC = this.PC + size;
        executeInstruction(this, opcode);
        this.PC = this.nextPC;
    }
    break() {
        this.esp.onBreak?.(this);
    }
    gdbReadRegister(reg) {
        const type = this.gdbRegisters[reg] & RegisterType.Mask;
        const index = this.gdbRegisters[reg] & ~RegisterType.Mask;
        switch (type) {
            case RegisterType.PC:
                return this.PC;
            case RegisterType.Special:
                return this.specialRegisters[index];
            case RegisterType.User:
                return this.userRegisters[index];
            case RegisterType.AR:
                return this.physicalRegisters[index];
        }
        console.warn('Unknown register', reg);
        return 0;
    }
    gdbWriteRegister(reg, value) {
        const type = this.gdbRegisters[reg] & RegisterType.Mask;
        const index = this.gdbRegisters[reg] & ~RegisterType.Mask;
        switch (type) {
            case RegisterType.PC:
                this.PC = value;
                break;
            case RegisterType.Special:
                this.specialRegisters[index] = value;
                break;
            case RegisterType.User:
                this.userRegisters[index] = value;
                break;
            case RegisterType.AR:
                this.physicalRegisters[index] = value;
                break;
            default:
                console.warn('Unknown register', reg);
                break;
        }
    }
}
//# sourceMappingURL=lx106-core.js.map