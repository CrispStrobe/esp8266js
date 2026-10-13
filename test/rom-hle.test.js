/**
 * The ROM stand-ins, called the way firmware calls them: registers loaded per
 * the CALL0 ABI, the program counter put on the ROM entry, one step taken.
 *
 * Expected values are worked out here from the C contracts, not read back
 * from the stand-ins.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ESP8266 } = require('../src/esp8266');
const { RomHle, RomFunctionMissing, ROM_FUNCTIONS } = require('../src/rom/rom-hle');
const { ROM_SYMBOLS } = require('../src/rom/rom-symbols');

const RAM = 0x3ffe8000;
const RETURN_TO = 0x40100010;

function machine() {
  const esp = new ESP8266();
  const rom = new RomHle(esp);
  rom.install();
  const core = esp.cores[0];
  const poke = (addr, bytes) => bytes.forEach((b, i) => esp.mapAddress(addr + i).writeUint8(addr + i, b));
  const peek = (addr, n) => Array.from({ length: n }, (_, i) => esp.mapAddress(addr + i).readUint8(addr + i));
  const str = (addr, s) => poke(addr, [...Buffer.from(s, 'latin1'), 0]);
  /** Call ROM function `name` with 32-bit arguments; returns {a2, a3}. */
  const call = (name, ...args) => {
    args.forEach((v, i) => core.setAR(2 + i, v >>> 0));
    core.setAR(0, RETURN_TO);
    core.PC = ROM_SYMBOLS[name];
    core.runInstruction();
    assert.equal(core.PC, RETURN_TO, `${name} returns to its caller`);
    return { a2: core.AR(2) >>> 0, a3: core.AR(3) >>> 0 };
  };
  return { esp, rom, core, poke, peek, str, call };
}

const dv = new DataView(new ArrayBuffer(8));
const dbl = (x) => { dv.setFloat64(0, x, true); return [dv.getUint32(0, true), dv.getUint32(4, true)]; };
const undbl = ({ a2, a3 }) => { dv.setUint32(0, a2, true); dv.setUint32(4, a3, true); return dv.getFloat64(0, true); };
const flt = (x) => { dv.setFloat32(0, x, true); return dv.getUint32(0, true); };
const unflt = ({ a2 }) => { dv.setUint32(0, a2, true); return dv.getFloat32(0, true); };
const u64 = (x) => [Number(x & 0xffffffffn), Number((x >> 32n) & 0xffffffffn)];
const un64 = ({ a2, a3 }) => (BigInt(a3) << 32n) | BigInt(a2);

test('the table is the measured one, and every stand-in is for a measured entry', () => {
  assert.equal(Object.keys(ROM_SYMBOLS).length, 97);
  for (const [name, addr] of Object.entries(ROM_SYMBOLS)) {
    assert.ok(addr >= 0x40000000 && addr <= 0x4000ffff, `${name} is in the ROM window`);
  }
  for (const name of Object.keys(ROM_FUNCTIONS)) assert.ok(name in ROM_SYMBOLS, `${name} is a measured ROM entry`);
  const { rom } = machine();
  assert.equal(rom.provided.length + rom.missing.length, 97);
  assert.equal(rom.provided.length, Object.keys(ROM_FUNCTIONS).length);
});

test('memory: copy, overlapping move in both directions, fill, compare', () => {
  const m = machine();
  m.poke(RAM, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(m.call('memcpy', RAM + 0x20, RAM, 8).a2, RAM + 0x20, 'memcpy returns dest');
  assert.deepEqual(m.peek(RAM + 0x20, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  m.call('memmove', RAM + 2, RAM, 6);                       // dest above src
  assert.deepEqual(m.peek(RAM, 8), [1, 2, 1, 2, 3, 4, 5, 6]);
  m.poke(RAM, [1, 2, 3, 4, 5, 6, 7, 8]);
  m.call('ets_memmove', RAM, RAM + 2, 6);                   // dest below src
  assert.deepEqual(m.peek(RAM, 8), [3, 4, 5, 6, 7, 8, 7, 8]);
  m.call('memset', RAM, 0x1ab, 3);                          // only the low byte is used
  assert.deepEqual(m.peek(RAM, 4), [0xab, 0xab, 0xab, 6]);
  m.call('ets_bzero', RAM, 2);
  assert.deepEqual(m.peek(RAM, 3), [0, 0, 0xab]);
  m.poke(RAM + 0x40, [9, 9, 1]);
  m.poke(RAM + 0x50, [9, 9, 200]);
  assert.equal(m.call('memcmp', RAM + 0x40, RAM + 0x50, 2).a2, 0);
  assert.ok((m.call('memcmp', RAM + 0x40, RAM + 0x50, 3).a2 | 0) < 0, 'bytes compare as unsigned: 1 < 200');
  assert.ok((m.call('ets_memcmp', RAM + 0x50, RAM + 0x40, 3).a2 | 0) > 0);
});

test('strings: length, compare, bounded compare, copy, bounded copy with padding, search', () => {
  const m = machine();
  m.str(RAM, 'hello');
  m.str(RAM + 0x10, 'help');
  assert.equal(m.call('strlen', RAM).a2, 5);
  assert.equal(m.call('ets_strlen', RAM + 0x10).a2, 4);
  assert.ok((m.call('strcmp', RAM, RAM + 0x10).a2 | 0) < 0, '"hello" < "help"');
  assert.equal(m.call('strcmp', RAM, RAM).a2, 0);
  assert.equal(m.call('strncmp', RAM, RAM + 0x10, 3).a2, 0, 'equal in the first three');
  assert.ok((m.call('ets_strncmp', RAM, RAM + 0x10, 4).a2 | 0) < 0);
  m.poke(RAM + 0x20, [0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee]);
  assert.equal(m.call('ets_strcpy', RAM + 0x20, RAM + 0x10).a2, RAM + 0x20);
  assert.deepEqual(m.peek(RAM + 0x20, 6), [104, 101, 108, 112, 0, 0xee], 'copied through the NUL, no further');
  m.poke(RAM + 0x30, [0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee]);
  m.call('ets_strncpy', RAM + 0x30, RAM + 0x10, 7);
  assert.deepEqual(m.peek(RAM + 0x30, 8), [104, 101, 108, 112, 0, 0, 0, 0xee], 'padded with NULs up to the limit');
  m.call('ets_strncpy', RAM + 0x30, RAM, 3);
  assert.deepEqual(m.peek(RAM + 0x30, 4), [104, 101, 108, 112], 'a truncated copy is not terminated');
  m.str(RAM + 0x60, 'lo');
  m.str(RAM + 0x70, 'xyz');
  m.str(RAM + 0x78, '');
  assert.equal(m.call('strstr', RAM, RAM + 0x60).a2, RAM + 3);
  assert.equal(m.call('strstr', RAM, RAM + 0x70).a2, 0);
  assert.equal(m.call('strstr', RAM, RAM + 0x78).a2, RAM, 'an empty needle matches at the start');
});

test('32-bit division and remainder, signed and unsigned', () => {
  const m = machine();
  assert.equal(m.call('__divsi3', -7, 2).a2 | 0, -3, 'truncates toward zero');
  assert.equal(m.call('__divsi3', 7, -2).a2 | 0, -3);
  assert.equal(m.call('__udivsi3', 0xfffffff9, 2).a2, 0x7ffffffc);
  assert.equal(m.call('__umodsi3', 0xfffffff9, 10).a2, 0xfffffff9 % 10);
  assert.equal(m.call('__divsi3', 0x80000000, -1).a2, 0x80000000, 'the overflowing quotient wraps');
});

test('64-bit multiply, division and remainder', () => {
  const m = machine();
  const a = 0x123456789abcdefn, b = 0xfedcban;
  assert.equal(un64(m.call('__muldi3', ...u64(a), ...u64(b))), (a * b) & 0xffffffffffffffffn);
  assert.equal(un64(m.call('__umulsidi3', 0xffffffff, 0xffffffff)), 0xfffffffe00000001n);
  assert.equal(un64(m.call('__udivdi3', ...u64(a), ...u64(b))), a / b);
  assert.equal(un64(m.call('__umoddi3', ...u64(a), ...u64(b))), a % b);
  const minus = BigInt.asUintN(64, -1000000000000n);
  assert.equal(BigInt.asIntN(64, un64(m.call('__divdi3', ...u64(minus), ...u64(7n)))), -142857142857n);
});

test('double arithmetic and conversions', () => {
  const m = machine();
  assert.equal(undbl(m.call('__adddf3', ...dbl(0.1), ...dbl(0.2))), 0.30000000000000004);
  assert.equal(undbl(m.call('__subdf3', ...dbl(1), ...dbl(0.75))), 0.25);
  assert.equal(undbl(m.call('__muldf3', ...dbl(1.5), ...dbl(-4))), -6);
  assert.equal(undbl(m.call('__divdf3', ...dbl(1), ...dbl(3))), 1 / 3);
  assert.equal(undbl(m.call('__floatsidf', -5)), -5);
  assert.equal(undbl(m.call('__floatunsidf', 0xfffffffb)), 4294967291);
  assert.equal(m.call('__fixdfsi', ...dbl(-2.9)).a2 | 0, -2, 'truncates toward zero');
  assert.equal(m.call('__fixunsdfsi', ...dbl(3000000000.7)).a2, 3000000000);
  assert.equal(undbl(m.call('__extendsfdf2', flt(0.1))), Math.fround(0.1));
  assert.equal(unflt(m.call('__truncdfsf2', ...dbl(0.1))), Math.fround(0.1));
});

test('single arithmetic and conversions', () => {
  const m = machine();
  const f = Math.fround;
  assert.equal(unflt(m.call('__addsf3', flt(0.1), flt(0.2))), f(f(0.1) + f(0.2)));
  assert.equal(unflt(m.call('__subsf3', flt(1), flt(0.75))), 0.25);
  assert.equal(unflt(m.call('__mulsf3', flt(1.1), flt(3))), f(f(1.1) * 3));
  assert.equal(unflt(m.call('__floatsisf', -16777217)), f(-16777217), 'rounds to the nearest single');
  assert.equal(unflt(m.call('__floatunsisf', 0xffffffff)), 4294967296);
  assert.equal(m.call('__fixunssfsi', flt(255.9)).a2, 255);
});

test('a ROM function with no stand-in stops the run by name, and is counted', () => {
  const m = machine();
  assert.ok(m.rom.missing.includes('MD5Init'), 'MD5Init has no stand-in');
  m.core.setAR(0, RETURN_TO);
  m.core.PC = ROM_SYMBOLS.MD5Init;
  assert.throws(() => m.core.runInstruction(), (e) => e instanceof RomFunctionMissing &&
    e.romFunction === 'MD5Init' && e.caller === RETURN_TO && /does not provide yet/.test(e.message));
  assert.equal(m.rom.calls.get('MD5Init'), 1);
  m.call('strlen', RAM);
  m.call('strlen', RAM);
  assert.equal(m.rom.calls.get('strlen'), 2);
});
