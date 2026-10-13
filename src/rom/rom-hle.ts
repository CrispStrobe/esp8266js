/**
 * Stand-ins for ESP8266 mask ROM functions, so firmware can run without the
 * ROM image.
 *
 * HOW. The ROM window is left empty. Every known ROM entry point
 * (rom-symbols.ts) gets a hook at its address: when the program counter
 * arrives there, the hook does what the function does, in the host, and
 * returns to the caller. Firmware uses the CALL0 ABI throughout (the LX106
 * has no register windows): arguments in a2..a7, result in a2 (a 64-bit value
 * in a2 = low word, a3 = high word), return address in a0.
 *
 * WHAT IS PROVIDED is exactly the `provided` list of an instance. A known ROM
 * entry with no stand-in is NOT skipped and does NOT return zero: it stops
 * the run through `onMissing`, by name, because firmware that carried on
 * after a ROM call that silently did nothing would fail somewhere else and
 * look like a simulator bug.
 *
 * WHAT IS NOT CLAIMED. The stand-ins are written from the functions'
 * documented C contracts (libc, libgcc), not from the ROM's code, which this
 * project neither ships nor reads. Where the ROM may differ from the
 * contract (division by zero, float-to-integer conversion of NaN and of
 * out-of-range values) the choice made here is stated at the function and has
 * not been compared with hardware.
 */
import { ESP8266 } from '../esp8266';
import { LX106Core } from '../core/lx106-core';
import { ROM_SYMBOLS } from './rom-symbols';
import { SYSTEM_FUNCTIONS } from './rom-system';
import { OS_FUNCTIONS } from './rom-os';

/** What the stand-ins remember between calls: the ROM's own variables, in the host. */
export interface IRomState {
  /** The character output routine firmware installed (ets_install_putc1), or 0 for the ROM's UART one. */
  putc: number;
  /** The UART the ROM's character output goes to (uart_buff_switch). */
  uart: number;
  /** What firmware last told the ROM the CPU frequency is, in MHz. */
  cpuMhz: number;
  /** Interrupt service routines by interrupt number (ets_isr_attach). */
  isr: Map<number, { fn: number; arg: number }>;
  /** Exception handlers by cause (_xtos_set_exception_handler). */
  exceptionHandlers: Map<number, number>;
  /** Tasks by priority (ets_task), each with the events posted to it and not yet delivered. */
  tasks: Map<number, { fn: number; queue: number; length: number; events: Array<[number, number]> }>;
  /** The routine ets_run calls when no task has an event (ets_set_idle_cb), or 0. */
  idle: { fn: number; arg: number };
}

/** The registers and memory a stand-in works with. */
export interface IRomCall {
  readonly esp: ESP8266;
  readonly state: IRomState;
  /**
   * Argument `n` as an unsigned 32-bit value: register a2+n for the first
   * six, then the caller's stack (how CALL0 passes further and variadic ones).
   */
  arg(n: number): number;
  /** Arguments `n` (low word) and `n + 1` (high word) as one unsigned 64-bit value. */
  arg64(n: number): bigint;
  /** Arguments `n`, `n + 1` as an IEEE-754 double. */
  argDouble(n: number): number;
  /** Argument `n` as an IEEE-754 single. */
  argFloat(n: number): number;
  read8(addr: number): number;
  write8(addr: number, value: number): void;
  read32(addr: number): number;
  write32(addr: number, value: number): void;
  /** Read or write the interrupt enable mask, so that newly enabled interrupts are noticed. */
  interruptEnable(update?: (mask: number) => number): number;
  /** The NUL-terminated bytes at `addr`, without the NUL. */
  cstring(addr: number): number[];
}

/**
 * A stand-in that has to run firmware code (a callback the firmware handed
 * to the ROM) returns this instead of a value: the function is called with
 * up to six arguments, and `then` receives its result and says how the
 * stand-in goes on, with a value or with another call.
 */
export interface IGuestCall {
  fn: number;
  args?: number[];
  then: (result: number) => RomResult;
}

/** What a stand-in returns: nothing, a 32-bit value, a wider one, or a call into firmware. */
export type RomResult =
  | void
  | number
  | { u64: bigint }
  | { double: number }
  | { float: number }
  | { callGuest: IGuestCall }
  | { wait: () => RomResult };

/**
 * Where the core rests while a stand-in waits for an interrupt (ets_run with
 * nothing to do), and where it comes back to afterwards. Not a ROM entry.
 */
export const WAIT_RESUME = 0x4000fff4;

/**
 * The radio. `phy_get_romfuncs` hands the SDK's radio library a table of
 * ROM routines it then calls by index. There is no radio here: every slot of
 * the table this simulator hands out points into PHY_STUBS, each call is
 * counted as `(radio ROM routine N)` and answered with 0. Firmware gets past
 * its radio start-up this way; nothing it then believes about the radio is
 * true.
 */
export const PHY_STUBS = 0x4000f000;
export const PHY_STUB_COUNT = 256;
/** Where the table itself is kept: in the RAM the ROM uses for its own data. */
export const PHY_TABLE = 0x3fffc800;

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

export class UnhandledException extends Error {
  constructor(readonly cause_: number, readonly pc: number, what: string) {
    super(`${what} (cause ${cause_}) at 0x${pc.toString(16)}, and the firmware registered no handler for it`);
  }
}

/**
 * Where firmware code called from a stand-in returns to. An address in the
 * ROM window that is not a ROM entry point; nothing is stored there.
 */
export const GUEST_RETURN = 0x4000fff0;

export type RomFunction = (call: IRomCall) => RomResult;

export class RomFunctionMissing extends Error {
  constructor(readonly romFunction: string, readonly address: number, readonly caller: number) {
    super(
      `the firmware called the ROM function ${romFunction} (0x${address.toString(16)}), ` +
        `which this simulator does not provide yet (called from 0x${caller.toString(16)})`
    );
  }
}

const scratch = new DataView(new ArrayBuffer(8));

function doubleFromBits(bits: bigint) {
  scratch.setBigUint64(0, bits, true);
  return scratch.getFloat64(0, true);
}

function bitsFromDouble(value: number) {
  scratch.setFloat64(0, value, true);
  return scratch.getBigUint64(0, true);
}

function floatFromBits(bits: number) {
  scratch.setUint32(0, bits, true);
  return scratch.getFloat32(0, true);
}

function bitsFromFloat(value: number) {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
}

const s64 = (value: bigint) => BigInt.asIntN(64, value);
const u64 = (value: bigint) => BigInt.asUintN(64, value);

/**
 * Float to signed 32-bit, truncating. Out-of-range values saturate and NaN
 * gives the largest positive value: libgcc's Xtensa behaviour as documented,
 * not compared with the ROM.
 */
function toInt32(value: number) {
  if (value !== value) return 0x7fffffff;
  if (value >= 2147483648) return 0x7fffffff;
  if (value <= -2147483649) return 0x80000000;
  return Math.trunc(value) >>> 0;
}

/**
 * Float to unsigned 32-bit, truncating. Negative values give 0, values past
 * the range and NaN give 0xffffffff: a choice, not compared with the ROM.
 */
function toUint32(value: number) {
  if (value !== value) return 0xffffffff;
  if (value >= 4294967296) return 0xffffffff;
  if (value <= -1) return 0;
  return Math.trunc(value) >>> 0;
}

function compareBytes(call: IRomCall, a: number, b: number, limit: number, stopAtNul: boolean) {
  for (let i = 0; i < limit; i++) {
    const x = call.read8(a + i);
    const y = call.read8(b + i);
    if (x !== y) return (x - y) >>> 0;
    if (stopAtNul && x === 0) return 0;
  }
  return 0;
}

function copyBytes(call: IRomCall, dest: number, src: number, count: number) {
  // Overlap-safe in both directions, so one routine serves memcpy and memmove.
  if (dest <= src) {
    for (let i = 0; i < count; i++) call.write8(dest + i, call.read8(src + i));
  } else {
    for (let i = count - 1; i >= 0; i--) call.write8(dest + i, call.read8(src + i));
  }
  return dest;
}

function fillBytes(call: IRomCall, dest: number, value: number, count: number) {
  for (let i = 0; i < count; i++) call.write8(dest + i, value & 0xff);
  return dest;
}

function copyString(call: IRomCall, dest: number, src: number, limit: number | null) {
  // strcpy copies through the NUL; strncpy stops at `limit` and pads with NULs.
  let i = 0;
  for (; limit == null || i < limit; i++) {
    const c = call.read8(src + i);
    call.write8(dest + i, c);
    if (c === 0) break;
  }
  if (limit != null) for (i++; i < limit; i++) call.write8(dest + i, 0);
  return dest;
}

function findString(call: IRomCall, haystack: number, needle: number) {
  const n = call.cstring(needle);
  if (!n.length) return haystack;
  const h = call.cstring(haystack);
  for (let i = 0; i + n.length <= h.length; i++) {
    let j = 0;
    while (j < n.length && h[i + j] === n[j]) j++;
    if (j === n.length) return haystack + i;
  }
  return 0;
}

const memcpy: RomFunction = (c) => copyBytes(c, c.arg(0), c.arg(1), c.arg(2));
const memset: RomFunction = (c) => fillBytes(c, c.arg(0), c.arg(1), c.arg(2));
const memcmp: RomFunction = (c) => compareBytes(c, c.arg(0), c.arg(1), c.arg(2), false);
const strlen: RomFunction = (c) => c.cstring(c.arg(0)).length;
const strncmp: RomFunction = (c) => compareBytes(c, c.arg(0), c.arg(1), c.arg(2), true);

/** Division by zero returns 0 (and the dividend for a remainder): a choice, not compared with the ROM. */
const div32 = (signed: boolean, remainder: boolean): RomFunction => (c) => {
  const a = signed ? c.arg(0) | 0 : c.arg(0);
  const b = signed ? c.arg(1) | 0 : c.arg(1);
  if (b === 0) return remainder ? a >>> 0 : 0;
  return (remainder ? a % b : Math.trunc(a / b)) >>> 0;
};

const div64 = (signed: boolean, remainder: boolean): RomFunction => (c) => {
  const a = signed ? s64(c.arg64(0)) : c.arg64(0);
  const b = signed ? s64(c.arg64(2)) : c.arg64(2);
  if (b === BigInt(0)) return { u64: remainder ? u64(a) : BigInt(0) };
  return { u64: u64(remainder ? a % b : a / b) };
};

const double2 = (op: (a: number, b: number) => number): RomFunction => (c) => ({
  double: op(c.argDouble(0), c.argDouble(2)),
});

/** Single precision: the double result rounded once to single is the correctly rounded single result for + - * /. */
const float2 = (op: (a: number, b: number) => number): RomFunction => (c) => ({
  float: op(c.argFloat(0), c.argFloat(1)),
});

/** The stand-ins this build provides, by ROM symbol name. */
export const ROM_FUNCTIONS: Readonly<Record<string, RomFunction>> = {
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
  ...SYSTEM_FUNCTIONS,

  // ── tasks, interrupts, exceptions (rom-os.ts) ──
  ...OS_FUNCTIONS,
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
export class RomHle {
  /** Calls per ROM function name, in the order first seen. */
  readonly calls = new Map<string, number>();
  /** What to do when firmware code called from the host returns, innermost last. */
  private readonly pending: Array<(core: LX106Core, result: number) => void> = [];
  /** The ROM's variables. */
  readonly state: IRomState = {
    putc: 0,
    uart: 0,
    cpuMhz: 80,
    isr: new Map(),
    exceptionHandlers: new Map(),
    tasks: new Map(),
    idle: { fn: 0, arg: 0 },
  };
  /** A stand-in waiting for an interrupt: how it goes on, and who called it. */
  private parked: { go: () => RomResult; caller: number } | null = null;
  /** Called for a known ROM entry with no stand-in. The default throws RomFunctionMissing. */
  onMissing: (name: string, address: number, caller: number) => void = (name, address, caller) => {
    throw new RomFunctionMissing(name, address, caller);
  };

  constructor(
    private readonly esp: ESP8266,
    private readonly functions: Readonly<Record<string, RomFunction>> = ROM_FUNCTIONS,
    private readonly symbols: Readonly<Record<string, number>> = ROM_SYMBOLS
  ) {}

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
      for (let i = 0; i < PHY_STUB_COUNT; i++) {
        const address = PHY_STUBS + i * 4;
        this.esp.mapAddress(PHY_TABLE + i * 4).writeUint32(PHY_TABLE + i * 4, address);
        breakpoints[address] = (c) => {
          const name = `(radio ROM routine ${i})`;
          this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
          c.setAR(2, 0);
          c.PC = c.AR(0) >>> 0;
          return true;
        };
      }
      breakpoints[GUEST_RETURN] = (c) => this.resume(c);
      breakpoints[WAIT_RESUME] = (c) => this.wake(c);
      breakpoints[KERNEL_VECTOR] = (c) => this.exception(c);
      breakpoints[USER_VECTOR] = (c) => this.exception(c);
      breakpoints[DOUBLE_VECTOR] = (c) => {
        throw new UnhandledException(
          c.specialRegisters[SR_EXCCAUSE],
          c.specialRegisters[SR_DEPC] >>> 0,
          'an exception inside an exception handler'
        );
      };
    }
  }

  private enter(core: LX106Core, name: string, address: number) {
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
  private resume(core: LX106Core) {
    const go = this.pending.pop();
    if (!go) {
      throw new Error('firmware returned to the ROM stand-in return address with no call in progress');
    }
    go(core, core.AR(2) >>> 0);
    return true;
  }

  /** Run firmware code at `fn`; `go` runs when it returns. */
  private callInto(
    core: LX106Core,
    fn: number,
    args: number[],
    go: (core: LX106Core, result: number) => void
  ) {
    this.pending.push(go);
    args.forEach((value, i) => core.setAR(2 + i, value >>> 0));
    core.setAR(0, GUEST_RETURN);
    core.PC = fn;
  }

  /** An interrupt has been served while a stand-in waited: let it look again. */
  private wake(core: LX106Core) {
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
  private exception(core: LX106Core) {
    const cause = core.specialRegisters[SR_EXCCAUSE];
    const epc = core.specialRegisters[SR_EPC1] >>> 0;
    const level = core.PS_INTLEVEL;
    if (cause === CAUSE_LEVEL1_INTERRUPT) {
      const saved = Array.from({ length: 16 }, (_, i) => core.AR(i));
      const sar = core.specialRegisters[SR_SAR];
      core.PS_EXCM = 0;
      core.PS_INTLEVEL = 1;
      const serve = () => {
        const due =
          core.specialRegisters[SR_INTSET] & core.specialRegisters[SR_INTENABLE] & 0xffffffff;
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
    const write = (i: number, value: number) =>
      this.esp.mapAddress(frame + i * 4).writeUint32(frame + i * 4, value >>> 0);
    const read = (i: number) => this.esp.mapAddress(frame + i * 4).readUint32(frame + i * 4) >>> 0;
    // Words: 0 epc, 1 ps, 2 sar, 3 unused, 4 a0, 5..18 a2..a15, 19 cause.
    write(0, epc);
    write(1, core.specialRegisters[230]);
    write(2, core.specialRegisters[SR_SAR]);
    write(3, 0);
    write(4, core.AR(0));
    for (let r = 2; r <= 15; r++) write(3 + r, core.AR(r));
    write(19, cause);
    core.setAR(1, frame);
    core.PS_EXCM = 0;
    core.PS_INTLEVEL = Math.max(level, 1);
    this.calls.set('(exception)', (this.calls.get('(exception)') ?? 0) + 1);
    this.callInto(core, handler, [frame, cause], () => {
      core.specialRegisters[SR_SAR] = read(2);
      core.setAR(0, read(4));
      for (let r = 2; r <= 15; r++) core.setAR(r, read(3 + r));
      core.setAR(1, sp);
      core.PS_INTLEVEL = level;
      core.PC = read(0);
    });
    return true;
  }

  /** Apply what a stand-in returned, and go back to `caller` or on into firmware. */
  private finish(core: LX106Core, result: RomResult, caller: number) {
    if (result && typeof result === 'object' && 'callGuest' in result) {
      const { fn, args = [], then } = result.callGuest;
      this.callInto(core, fn, args, (c, value) => this.finish(c, then(value), caller));
      return;
    }
    if (result && typeof result === 'object' && 'wait' in result) {
      // Rest with interrupts open; an interrupt returns to WAIT_RESUME.
      this.parked = { go: result.wait, caller };
      core.PS_INTLEVEL = 0;
      core.PC = WAIT_RESUME;
      core.idle = true;
      return;
    }
    if (typeof result === 'number') {
      core.setAR(2, result >>> 0);
    } else if (result) {
      let bits: bigint | null = null;
      if ('u64' in result) bits = result.u64;
      else if ('double' in result) bits = bitsFromDouble(result.double);
      if (bits != null) {
        core.setAR(2, Number(bits & BigInt(0xffffffff)));
        core.setAR(3, Number((bits >> BigInt(32)) & BigInt(0xffffffff)));
      } else if ('float' in result) {
        core.setAR(2, bitsFromFloat(result.float));
      }
    }
    // A stand-in called from firmware returns as a C function does: a0 is the
    // caller's again (firmware code called in between has overwritten it).
    core.setAR(0, caller);
    core.PC = caller;
  }

  private callFor(core: LX106Core): IRomCall {
    const { esp, state } = this;
    const read32 = (addr: number) => esp.mapAddress(addr >>> 0).readUint32(addr >>> 0) >>> 0;
    const arg = (n: number) =>
      n < 6 ? core.AR(2 + n) >>> 0 : read32((core.AR(1) >>> 0) + (n - 6) * 4);
    const arg64 = (n: number) => (BigInt(arg(n + 1)) << BigInt(32)) | BigInt(arg(n));
    const read8 = (addr: number) => esp.mapAddress(addr >>> 0).readUint8(addr >>> 0);
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
        const bytes: number[] = [];
        for (let a = addr >>> 0; ; a++) {
          const c = read8(a);
          if (c === 0) return bytes;
          bytes.push(c);
        }
      },
    };
  }
}
