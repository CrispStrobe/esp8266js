"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RomHle = exports.ROM_FUNCTIONS = exports.RomFunctionMissing = exports.GUEST_RETURN = exports.UnhandledException = exports.XTOS_ENTRIES = exports.XTOS_TABLE = exports.PHY_TABLE = exports.PHY_STUB_COUNT = exports.PHY_STUBS = exports.WAIT_RESUME = void 0;
const rom_symbols_1 = require("./rom-symbols");
const rom_system_1 = require("./rom-system");
const rom_os_1 = require("./rom-os");
/**
 * Where the core rests while a stand-in waits for an interrupt (ets_run with
 * nothing to do), and where it comes back to afterwards. Not a ROM entry.
 */
exports.WAIT_RESUME = 0x4000fff4;
/**
 * The radio. `phy_get_romfuncs` hands the SDK's radio library a table of
 * ROM routines it then calls by index. There is no radio here: every slot of
 * the table this simulator hands out points into PHY_STUBS, each call is
 * counted as `(radio ROM routine N)` and answered with 0. Firmware gets past
 * its radio start-up this way; nothing it then believes about the radio is
 * true.
 */
exports.PHY_STUBS = 0x4000f000;
exports.PHY_STUB_COUNT = 256;
/** Where the table itself is kept: in the RAM the ROM uses for its own data. */
exports.PHY_TABLE = 0x3fffc800;
/**
 * The ROM's exception dispatch table. Firmware that installs its own vectors
 * (the SDK does, at 0x40100000) still ends up in the ROM: its vector code
 * looks the handler up in a table the ROM keeps at the start of its RAM, one
 * word per exception cause, and jumps there. Each slot is seeded to point at
 * XTOS_ENTRIES + 4 * cause, which leads into the dispatcher below.
 *
 * What that vector code has done by the time it jumps was read off the
 * firmware's own code (Arduino core 3.1.2 images), not off the ROM: a0 is in
 * EXCSAVE1, the stack pointer is lowered by 0x100, and a2, a3, a4 are stored
 * at 0x14, 0x18, 0x1c of that frame. An image whose vector code differs
 * would be dispatched wrongly.
 */
exports.XTOS_TABLE = 0x3fffc000;
exports.XTOS_ENTRIES = 0x4000f800;
const XTOS_CAUSES = 64;
const XTOS_FRAME = 0x100;
const SR_EXCSAVE1 = 209;
/** The exception vectors, relative to VECBASE (0x40000000: they are in the ROM). */
const KERNEL_VECTOR = 0x40000030;
const USER_VECTOR = 0x40000050;
const DOUBLE_VECTOR = 0x40000070;
const CAUSE_LEVEL1_INTERRUPT = 4;
const SR_SAR = 3;
const SR_EPC1 = 177;
const SR_DEPC = 192;
const SR_INTSET = 226;
const SR_INTENABLE = 228;
const SR_EXCCAUSE = 232;
/** Bytes of stack the exception frame handed to a handler takes (20 words, kept 16-aligned). */
const EXCEPTION_FRAME = 96;
class UnhandledException extends Error {
    constructor(cause_, pc, what) {
        super(`${what} (cause ${cause_}) at 0x${pc.toString(16)}, and the firmware registered no handler for it`);
        this.cause_ = cause_;
        this.pc = pc;
    }
}
exports.UnhandledException = UnhandledException;
/**
 * Where firmware code called from a stand-in returns to. An address in the
 * ROM window that is not a ROM entry point; nothing is stored there.
 */
exports.GUEST_RETURN = 0x4000fff0;
class RomFunctionMissing extends Error {
    constructor(romFunction, address, caller) {
        super(`the firmware called the ROM function ${romFunction} (0x${address.toString(16)}), ` +
            `which this simulator does not provide yet (called from 0x${caller.toString(16)})`);
        this.romFunction = romFunction;
        this.address = address;
        this.caller = caller;
    }
}
exports.RomFunctionMissing = RomFunctionMissing;
const scratch = new DataView(new ArrayBuffer(8));
function doubleFromBits(bits) {
    scratch.setBigUint64(0, bits, true);
    return scratch.getFloat64(0, true);
}
function bitsFromDouble(value) {
    scratch.setFloat64(0, value, true);
    return scratch.getBigUint64(0, true);
}
function floatFromBits(bits) {
    scratch.setUint32(0, bits, true);
    return scratch.getFloat32(0, true);
}
function bitsFromFloat(value) {
    scratch.setFloat32(0, value, true);
    return scratch.getUint32(0, true);
}
const s64 = (value) => BigInt.asIntN(64, value);
const u64 = (value) => BigInt.asUintN(64, value);
/**
 * Float to signed 32-bit, truncating. Out-of-range values saturate and NaN
 * gives the largest positive value: libgcc's Xtensa behaviour as documented,
 * not compared with the ROM.
 */
function toInt32(value) {
    if (value !== value)
        return 0x7fffffff;
    if (value >= 2147483648)
        return 0x7fffffff;
    if (value <= -2147483649)
        return 0x80000000;
    return Math.trunc(value) >>> 0;
}
/**
 * Float to unsigned 32-bit, truncating. Negative values give 0, values past
 * the range and NaN give 0xffffffff: a choice, not compared with the ROM.
 */
function toUint32(value) {
    if (value !== value)
        return 0xffffffff;
    if (value >= 4294967296)
        return 0xffffffff;
    if (value <= -1)
        return 0;
    return Math.trunc(value) >>> 0;
}
function compareBytes(call, a, b, limit, stopAtNul) {
    for (let i = 0; i < limit; i++) {
        const x = call.read8(a + i);
        const y = call.read8(b + i);
        if (x !== y)
            return (x - y) >>> 0;
        if (stopAtNul && x === 0)
            return 0;
    }
    return 0;
}
function copyBytes(call, dest, src, count) {
    // Overlap-safe in both directions, so one routine serves memcpy and memmove.
    if (dest <= src) {
        for (let i = 0; i < count; i++)
            call.write8(dest + i, call.read8(src + i));
    }
    else {
        for (let i = count - 1; i >= 0; i--)
            call.write8(dest + i, call.read8(src + i));
    }
    return dest;
}
function fillBytes(call, dest, value, count) {
    for (let i = 0; i < count; i++)
        call.write8(dest + i, value & 0xff);
    return dest;
}
function copyString(call, dest, src, limit) {
    // strcpy copies through the NUL; strncpy stops at `limit` and pads with NULs.
    let i = 0;
    for (; limit == null || i < limit; i++) {
        const c = call.read8(src + i);
        call.write8(dest + i, c);
        if (c === 0)
            break;
    }
    if (limit != null)
        for (i++; i < limit; i++)
            call.write8(dest + i, 0);
    return dest;
}
function findString(call, haystack, needle) {
    const n = call.cstring(needle);
    if (!n.length)
        return haystack;
    const h = call.cstring(haystack);
    for (let i = 0; i + n.length <= h.length; i++) {
        let j = 0;
        while (j < n.length && h[i + j] === n[j])
            j++;
        if (j === n.length)
            return haystack + i;
    }
    return 0;
}
const memcpy = (c) => copyBytes(c, c.arg(0), c.arg(1), c.arg(2));
const memset = (c) => fillBytes(c, c.arg(0), c.arg(1), c.arg(2));
const memcmp = (c) => compareBytes(c, c.arg(0), c.arg(1), c.arg(2), false);
const strlen = (c) => c.cstring(c.arg(0)).length;
const strncmp = (c) => compareBytes(c, c.arg(0), c.arg(1), c.arg(2), true);
/** Division by zero returns 0 (and the dividend for a remainder): a choice, not compared with the ROM. */
const div32 = (signed, remainder) => (c) => {
    const a = signed ? c.arg(0) | 0 : c.arg(0);
    const b = signed ? c.arg(1) | 0 : c.arg(1);
    if (b === 0)
        return remainder ? a >>> 0 : 0;
    return (remainder ? a % b : Math.trunc(a / b)) >>> 0;
};
const div64 = (signed, remainder) => (c) => {
    const a = signed ? s64(c.arg64(0)) : c.arg64(0);
    const b = signed ? s64(c.arg64(2)) : c.arg64(2);
    if (b === BigInt(0))
        return { u64: remainder ? u64(a) : BigInt(0) };
    return { u64: u64(remainder ? a % b : a / b) };
};
const double2 = (op) => (c) => ({
    double: op(c.argDouble(0), c.argDouble(2)),
});
/** Single precision: the double result rounded once to single is the correctly rounded single result for + - * /. */
const float2 = (op) => (c) => ({
    float: op(c.argFloat(0), c.argFloat(1)),
});
/** The stand-ins this build provides, by ROM symbol name. */
exports.ROM_FUNCTIONS = {
    // ── memory and strings (C library contracts) ──
    memcpy,
    memmove: memcpy,
    memset,
    memcmp,
    strlen,
    strcmp: (c) => compareBytes(c, c.arg(0), c.arg(1), 0x7fffffff, true),
    strncmp,
    strstr: (c) => findString(c, c.arg(0), c.arg(1)),
    ets_memcpy: memcpy,
    ets_memmove: memcpy,
    ets_memset: memset,
    ets_memcmp: memcmp,
    ets_bzero: (c) => {
        fillBytes(c, c.arg(0), 0, c.arg(1));
    },
    ets_strlen: strlen,
    ets_strncmp: strncmp,
    ets_strcpy: (c) => copyString(c, c.arg(0), c.arg(1), null),
    ets_strncpy: (c) => copyString(c, c.arg(0), c.arg(1), c.arg(2)),
    // ── integer arithmetic (libgcc contracts) ──
    __divsi3: div32(true, false),
    __udivsi3: div32(false, false),
    __umodsi3: div32(false, true),
    __divdi3: div64(true, false),
    __udivdi3: div64(false, false),
    __umoddi3: div64(false, true),
    __muldi3: (c) => ({ u64: u64(c.arg64(0) * c.arg64(2)) }),
    __umulsidi3: (c) => ({ u64: BigInt(c.arg(0)) * BigInt(c.arg(1)) }),
    // ── floating point (libgcc soft-float contracts, IEEE-754 round-to-nearest) ──
    __adddf3: double2((a, b) => a + b),
    __subdf3: double2((a, b) => a - b),
    __muldf3: double2((a, b) => a * b),
    __divdf3: double2((a, b) => a / b),
    __addsf3: float2((a, b) => a + b),
    __subsf3: float2((a, b) => a - b),
    __mulsf3: float2((a, b) => a * b),
    __extendsfdf2: (c) => ({ double: c.argFloat(0) }),
    __truncdfsf2: (c) => ({ float: c.argDouble(0) }),
    __fixdfsi: (c) => toInt32(c.argDouble(0)),
    __fixunsdfsi: (c) => toUint32(c.argDouble(0)),
    __fixunssfsi: (c) => toUint32(c.argFloat(0)),
    __floatsidf: (c) => ({ double: c.arg(0) | 0 }),
    __floatunsidf: (c) => ({ double: c.arg(0) }),
    __floatsisf: (c) => ({ float: c.arg(0) | 0 }),
    __floatunsisf: (c) => ({ float: c.arg(0) }),
    // ── flash, console, clock, pins (rom-system.ts) ──
    ...rom_system_1.SYSTEM_FUNCTIONS,
    // ── tasks, interrupts, exceptions (rom-os.ts) ──
    ...rom_os_1.OS_FUNCTIONS,
};
/**
 * Installs the stand-ins on an ESP8266 and counts what the firmware calls.
 *
 *   const rom = new RomHle(esp);
 *   rom.install();
 *
 * `calls` is the run's own census: how often each ROM entry was reached,
 * provided or not.
 */
class RomHle {
    constructor(esp, functions = exports.ROM_FUNCTIONS, symbols = rom_symbols_1.ROM_SYMBOLS) {
        this.esp = esp;
        this.functions = functions;
        this.symbols = symbols;
        /** Calls per ROM function name, in the order first seen. */
        this.calls = new Map();
        /** What to do when firmware code called from the host returns, innermost last. */
        this.pending = [];
        /** The ROM's variables. */
        this.state = {
            putc: 0,
            uart: 0,
            cpuMhz: 80,
            isr: new Map(),
            exceptionHandlers: new Map(),
            tasks: new Map(),
            idle: { fn: 0, arg: 0 },
        };
        /** A stand-in waiting for an interrupt: how it goes on, and who called it. */
        this.parked = null;
        /** Called for a known ROM entry with no stand-in. The default throws RomFunctionMissing. */
        this.onMissing = (name, address, caller) => {
            throw new RomFunctionMissing(name, address, caller);
        };
    }
    /** Names of the ROM entries that have a stand-in. */
    get provided() {
        return Object.keys(this.symbols).filter((name) => this.functions[name]);
    }
    /** Names of the known ROM entries that stop the run if reached. */
    get missing() {
        return Object.keys(this.symbols).filter((name) => !this.functions[name]);
    }
    install() {
        for (const core of this.esp.cores) {
            const breakpoints = core.breakpoints ?? (core.breakpoints = {});
            for (const [name, address] of Object.entries(this.symbols)) {
                breakpoints[address] = (c) => this.enter(c, name, address);
            }
            for (let i = 0; i < exports.PHY_STUB_COUNT; i++) {
                const address = exports.PHY_STUBS + i * 4;
                this.esp.mapAddress(exports.PHY_TABLE + i * 4).writeUint32(exports.PHY_TABLE + i * 4, address);
                breakpoints[address] = (c) => {
                    const name = `(radio ROM routine ${i})`;
                    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
                    c.setAR(2, 0);
                    c.PC = c.AR(0) >>> 0;
                    return true;
                };
            }
            for (let cause = 0; cause < XTOS_CAUSES; cause++) {
                const address = exports.XTOS_ENTRIES + cause * 4;
                this.esp.mapAddress(exports.XTOS_TABLE + cause * 4).writeUint32(exports.XTOS_TABLE + cause * 4, address);
                breakpoints[address] = (c) => {
                    // Undo what the firmware's vector code did, then dispatch as from a ROM vector.
                    const frame = c.AR(1) >>> 0;
                    const read = (at) => this.esp.mapAddress(frame + at).readUint32(frame + at);
                    c.setAR(0, c.specialRegisters[SR_EXCSAVE1]);
                    c.setAR(2, read(0x14));
                    c.setAR(3, read(0x18));
                    c.setAR(4, read(0x1c));
                    c.setAR(1, frame + XTOS_FRAME);
                    return this.exception(c);
                };
            }
            breakpoints[exports.GUEST_RETURN] = (c) => this.resume(c);
            breakpoints[exports.WAIT_RESUME] = (c) => this.wake(c);
            breakpoints[KERNEL_VECTOR] = (c) => this.exception(c);
            breakpoints[USER_VECTOR] = (c) => this.exception(c);
            breakpoints[DOUBLE_VECTOR] = (c) => {
                throw new UnhandledException(c.specialRegisters[SR_EXCCAUSE], c.specialRegisters[SR_DEPC] >>> 0, 'an exception inside an exception handler');
            };
        }
    }
    enter(core, name, address) {
        this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
        const caller = core.AR(0);
        const fn = this.functions[name];
        if (!fn) {
            this.onMissing(name, address, caller);
            return true;
        }
        this.finish(core, fn(this.callFor(core)), caller);
        return true;
    }
    /** Firmware code called from a stand-in has returned: carry on with that stand-in. */
    resume(core) {
        const go = this.pending.pop();
        if (!go) {
            throw new Error('firmware returned to the ROM stand-in return address with no call in progress');
        }
        go(core, core.AR(2) >>> 0);
        return true;
    }
    /** Run firmware code at `fn`; `go` runs when it returns. */
    callInto(core, fn, args, go) {
        this.pending.push(go);
        args.forEach((value, i) => core.setAR(2 + i, value >>> 0));
        core.setAR(0, exports.GUEST_RETURN);
        core.PC = fn;
    }
    /** An interrupt has been served while a stand-in waited: let it look again. */
    wake(core) {
        const parked = this.parked;
        if (!parked) {
            throw new Error('the core reached the ROM wait address with no stand-in waiting');
        }
        this.parked = null;
        this.finish(core, parked.go(), parked.caller);
        return true;
    }
    /**
     * The exception vectors are ROM code, so taking an exception or a level-1
     * interrupt lands here. This does what the ROM's dispatcher is for: save
     * the interrupted registers, call what the firmware registered, restore,
     * and return to the interrupted instruction.
     *
     * Interrupts: every pending enabled one is served, highest number first,
     * with level-1 interrupts masked meanwhile. The order is an assumption
     * (the usual XTOS default), not something read from the ROM.
     *
     * Other exceptions: the registered handler gets a pointer to a frame on
     * the stack { epc, ps, sar, unused, a0, a2..a15, cause } and the cause, may
     * change the frame, and execution resumes from what the frame then says.
     */
    exception(core) {
        const cause = core.specialRegisters[SR_EXCCAUSE];
        const epc = core.specialRegisters[SR_EPC1] >>> 0;
        const level = core.PS_INTLEVEL;
        if (cause === CAUSE_LEVEL1_INTERRUPT) {
            const saved = Array.from({ length: 16 }, (_, i) => core.AR(i));
            const sar = core.specialRegisters[SR_SAR];
            core.PS_EXCM = 0;
            core.PS_INTLEVEL = 1;
            const serve = () => {
                const due = core.specialRegisters[SR_INTSET] & core.specialRegisters[SR_INTENABLE] & 0xffffffff;
                if (!due) {
                    saved.forEach((value, i) => core.setAR(i, value));
                    core.specialRegisters[SR_SAR] = sar;
                    core.PS_INTLEVEL = level;
                    core.PC = epc;
                    core.pendingInterrupts = false;
                    return;
                }
                const number = 31 - Math.clz32(due);
                const isr = this.state.isr.get(number);
                if (!isr) {
                    throw new UnhandledException(cause, epc, `interrupt ${number} with no service routine`);
                }
                // The two hardware timers interrupt on an edge: the core latches the
                // request and the dispatcher clears the latch before calling the
                // routine (a level request would simply still be there afterwards).
                if (number === 9 || number === 10) {
                    core.specialRegisters[SR_INTSET] &= ~(1 << number);
                }
                this.calls.set('(interrupt)', (this.calls.get('(interrupt)') ?? 0) + 1);
                this.callInto(core, isr.fn, [isr.arg], serve);
            };
            serve();
            return true;
        }
        const handler = this.state.exceptionHandlers.get(cause);
        if (!handler) {
            throw new UnhandledException(cause, epc, 'an exception');
        }
        const sp = core.AR(1) >>> 0;
        const frame = sp - EXCEPTION_FRAME;
        const write = (i, value) => this.esp.mapAddress(frame + i * 4).writeUint32(frame + i * 4, value >>> 0);
        const read = (i) => this.esp.mapAddress(frame + i * 4).readUint32(frame + i * 4) >>> 0;
        // Words: 0 epc, 1 ps, 2 sar, 3 unused, 4 a0, 5..18 a2..a15, 19 cause.
        write(0, epc);
        write(1, core.specialRegisters[230]);
        write(2, core.specialRegisters[SR_SAR]);
        write(3, 0);
        write(4, core.AR(0));
        for (let r = 2; r <= 15; r++)
            write(3 + r, core.AR(r));
        write(19, cause);
        core.setAR(1, frame);
        core.PS_EXCM = 0;
        core.PS_INTLEVEL = Math.max(level, 1);
        this.calls.set('(exception)', (this.calls.get('(exception)') ?? 0) + 1);
        this.callInto(core, handler, [frame, cause], () => {
            core.specialRegisters[SR_SAR] = read(2);
            core.setAR(0, read(4));
            for (let r = 2; r <= 15; r++)
                core.setAR(r, read(3 + r));
            core.setAR(1, sp);
            core.PS_INTLEVEL = level;
            core.PC = read(0);
        });
        return true;
    }
    /** Apply what a stand-in returned, and go back to `caller` or on into firmware. */
    finish(core, result, caller) {
        if (result && typeof result === 'object' && 'callGuest' in result) {
            const { fn, args = [], then } = result.callGuest;
            this.callInto(core, fn, args, (c, value) => this.finish(c, then(value), caller));
            return;
        }
        if (result && typeof result === 'object' && 'wait' in result) {
            // Rest with interrupts open; an interrupt returns to WAIT_RESUME.
            this.parked = { go: result.wait, caller };
            core.PS_INTLEVEL = 0;
            core.PC = exports.WAIT_RESUME;
            core.idle = true;
            return;
        }
        if (typeof result === 'number') {
            core.setAR(2, result >>> 0);
        }
        else if (result) {
            let bits = null;
            if ('u64' in result)
                bits = result.u64;
            else if ('double' in result)
                bits = bitsFromDouble(result.double);
            if (bits != null) {
                core.setAR(2, Number(bits & BigInt(0xffffffff)));
                core.setAR(3, Number((bits >> BigInt(32)) & BigInt(0xffffffff)));
            }
            else if ('float' in result) {
                core.setAR(2, bitsFromFloat(result.float));
            }
        }
        // A stand-in called from firmware returns as a C function does: a0 is the
        // caller's again (firmware code called in between has overwritten it).
        core.setAR(0, caller);
        core.PC = caller;
    }
    callFor(core) {
        const { esp, state } = this;
        const read32 = (addr) => esp.mapAddress(addr >>> 0).readUint32(addr >>> 0) >>> 0;
        const arg = (n) => n < 6 ? core.AR(2 + n) >>> 0 : read32((core.AR(1) >>> 0) + (n - 6) * 4);
        const arg64 = (n) => (BigInt(arg(n + 1)) << BigInt(32)) | BigInt(arg(n));
        const read8 = (addr) => esp.mapAddress(addr >>> 0).readUint8(addr >>> 0);
        return {
            esp,
            state,
            arg,
            arg64,
            read32,
            interruptEnable: (update) => {
                if (update) {
                    core.writeSpecialRegister(SR_INTENABLE, update(core.specialRegisters[SR_INTENABLE]) >>> 0);
                    core.pendingInterrupts = true;
                }
                return core.specialRegisters[SR_INTENABLE] >>> 0;
            },
            write32: (addr, value) => esp.mapAddress(addr >>> 0).writeUint32(addr >>> 0, value >>> 0),
            argDouble: (n) => doubleFromBits(arg64(n)),
            argFloat: (n) => floatFromBits(arg(n)),
            read8,
            write8: (addr, value) => esp.mapAddress(addr >>> 0).writeUint8(addr >>> 0, value & 0xff),
            cstring: (addr) => {
                const bytes = [];
                for (let a = addr >>> 0;; a++) {
                    const c = read8(a);
                    if (c === 0)
                        return bytes;
                    bytes.push(c);
                }
            },
        };
    }
}
exports.RomHle = RomHle;
//# sourceMappingURL=rom-hle.js.map