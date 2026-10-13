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

/** The registers and memory a stand-in works with. */
export interface IRomCall {
  /** Argument `n` (0..5), i.e. register a2+n, as an unsigned 32-bit value. */
  arg(n: number): number;
  /** Arguments `n` (low word) and `n + 1` (high word) as one unsigned 64-bit value. */
  arg64(n: number): bigint;
  /** Arguments `n`, `n + 1` as an IEEE-754 double. */
  argDouble(n: number): number;
  /** Argument `n` as an IEEE-754 single. */
  argFloat(n: number): number;
  read8(addr: number): number;
  write8(addr: number, value: number): void;
  /** The NUL-terminated bytes at `addr`, without the NUL. */
  cstring(addr: number): number[];
}

/** What a stand-in returns: nothing, a 32-bit value, or a wider one. */
export type RomResult =
  | void
  | number
  | { u64: bigint }
  | { double: number }
  | { float: number };

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
    const result = fn(this.callFor(core));
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
    core.PC = caller;
    return true;
  }

  private callFor(core: LX106Core): IRomCall {
    const { esp } = this;
    const arg = (n: number) => core.AR(2 + n) >>> 0;
    const arg64 = (n: number) => (BigInt(arg(n + 1)) << BigInt(32)) | BigInt(arg(n));
    const read8 = (addr: number) => esp.mapAddress(addr >>> 0).readUint8(addr >>> 0);
    return {
      arg,
      arg64,
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
