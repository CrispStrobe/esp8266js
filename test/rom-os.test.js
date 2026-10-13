/**
 * The ROM stand-ins that run the machine: loader, flash, console, delay,
 * tasks, interrupts, exceptions.
 *
 * No SDK or Arduino code is involved. "Firmware" here is a two-byte function
 * (`ret.n`) placed in instruction RAM; a breakpoint on it records what it was
 * called with before it returns.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ESP8266 } = require('../src/esp8266');
const {
  RomHle, UnhandledException, GUEST_RETURN, WAIT_RESUME, XTOS_TABLE, XTOS_ENTRIES,
} = require('../src/rom/rom-hle');
const { ROM_SYMBOLS } = require('../src/rom/rom-symbols');
const { loadImage, bootFromFlash, seedRomData, NotAnImage, BOOT_STACK, ROM_FLASHCHIP_POINTER } = require('../src/rom/boot');

const RAM = 0x3ffe8000;
const IRAM = 0x40100000;
const HOME = IRAM + 0x800;        // where "the caller" lives: a ret.n that returns to itself
const RET_N = [0x0d, 0xf0];

function machine() {
  const esp = new ESP8266();
  const rom = new RomHle(esp);
  rom.install();
  const core = esp.cores[0];
  core.PS_UM = 1;
  const w8 = (addr, v) => esp.mapAddress(addr).writeUint8(addr, v);
  const poke = (addr, bytes) => bytes.forEach((b, i) => w8(addr + i, b));
  const r32 = (addr) => esp.mapAddress(addr).readUint32(addr) >>> 0;
  const w32 = (addr, v) => esp.mapAddress(addr).writeUint32(addr, v >>> 0);
  const str = (addr, s) => poke(addr, [...Buffer.from(s, 'latin1'), 0]);
  poke(HOME, RET_N);
  /** A firmware function at `addr` that records its first two arguments and returns `result`. */
  const guest = (addr, log, name, result) => {
    poke(addr, RET_N);
    core.breakpoints[addr] = (c) => {
      log.push([name, c.AR(2) >>> 0, c.AR(3) >>> 0]);
      if (result !== undefined) c.setAR(2, result);
      return false;
    };
  };
  /** Enter ROM function `name` as a call from HOME. */
  const enter = (name, ...args) => {
    args.forEach((v, i) => core.setAR(2 + i, v >>> 0));
    core.setAR(0, HOME);
    core.PC = ROM_SYMBOLS[name];
    core.runInstruction();
  };
  /** Call ROM function `name` and run until it has returned to HOME. */
  const call = (name, ...args) => {
    enter(name, ...args);
    for (let i = 0; core.PC !== HOME; i++) {
      assert.ok(i < 10000, `${name} did not return`);
      core.runInstruction();
    }
    return core.AR(2) >>> 0;
  };
  const uart = [];
  esp.uart[0].onTX = (v) => { uart.push(v); esp.uart[0].txComplete(); };
  const printed = () => Buffer.from(uart).toString('latin1');
  return { esp, rom, core, poke, r32, w32, str, guest, enter, call, printed };
}

test('an image is loaded segment by segment, and what is not an image is refused', () => {
  const m = machine();
  assert.throws(() => loadImage(m.esp, 0), (e) => e instanceof NotAnImage && /found 0xff/.test(e.message));
  const image = [0xe9, 2, 0, 0, 0x10, 0x00, 0x10, 0x40,          // magic, 2 segments, entry 0x40100010
    0x00, 0x00, 0x10, 0x40, 4, 0, 0, 0, 1, 2, 3, 4,              // 4 bytes at 0x40100000
    0x00, 0x90, 0xfe, 0x3f, 2, 0, 0, 0, 9, 8];                   // 2 bytes at 0x3ffe9000
  m.esp.flash.set(image, 0x1000);
  const loaded = loadImage(m.esp, 0x1000);
  assert.deepEqual(loaded, { entry: 0x40100010, segments: [{ address: 0x40100000, length: 4 }, { address: 0x3ffe9000, length: 2 }] });
  assert.equal(m.r32(0x40100000), 0x04030201);
  assert.equal(m.r32(0x3ffe9000) & 0xffff, 0x0809);
  m.esp.flash.set(image, 0);
  bootFromFlash(m.esp);
  assert.equal(m.core.PC, 0x40100010);
  assert.equal(m.core.AR(1) >>> 0, BOOT_STACK);
  assert.equal(m.core.PS_UM, 1, 'firmware starts in user mode');
});

test('the ROM variables firmware reads are seeded: the flash description', () => {
  const m = machine();
  seedRomData(m.esp);
  const chip = m.r32(ROM_FLASHCHIP_POINTER);
  assert.equal(m.r32(chip + 4), m.esp.flash.length, 'chip size is the simulated flash');
  assert.deepEqual([m.r32(chip + 8), m.r32(chip + 12), m.r32(chip + 16)], [0x10000, 0x1000, 0x100]);
});

test('flash: read, program (bits only clear), erase a sector, refuse what is out of range', () => {
  const m = machine();
  m.esp.flash.set([0xf0, 0x0f], 0x2000);
  m.poke(RAM, [0x3c, 0xff]);
  assert.equal(m.call('SPIWrite', 0x2000, RAM, 2), 0);
  assert.deepEqual([...m.esp.flash.subarray(0x2000, 0x2002)], [0x30, 0x0f], 'programming ANDs');
  assert.equal(m.call('SPIRead', 0x2000, RAM + 0x10, 2), 0);
  assert.equal(m.r32(RAM + 0x10) & 0xffff, 0x0f30);
  assert.equal(m.call('SPIEraseSector', 2), 0);
  assert.deepEqual([...m.esp.flash.subarray(0x2000, 0x2002)], [0xff, 0xff]);
  assert.equal(m.esp.flash[0x1fff] === 0xff && m.esp.flash[0x3000] === 0xff, true);
  assert.equal(m.call('SPIRead', m.esp.flash.length - 1, RAM, 2), 1, 'past the end is an error, not a short read');
  assert.equal(m.call('SPIEraseSector', m.esp.flash.length / 4096), 1);
});

test('ets_printf formats to the ROM console, with further arguments from the stack', () => {
  const m = machine();
  m.str(RAM, '%d|%5u|%05x|%s|%c|%%|%-4dX|%X|%q|%d %d');
  m.str(RAM + 0x80, 'ok');
  const sp = RAM + 0x400;
  m.core.setAR(1, sp);
  m.w32(sp, 77);                    // the 7th argument
  m.w32(sp + 4, 0xffffffff);        // the 8th
  // a2 = format, then a3..a7 = -12, 34, 0xab, "ok", 'Z'; then 77 and -1 on the stack... but
  // %-4d takes the 7th value and %X the 8th, so the last two %d read on up the stack.
  m.w32(sp + 8, 5);
  m.w32(sp + 12, 6);
  const n = m.call('ets_printf', RAM, -12, 34, 0xab, RAM + 0x80, 0x5a);
  assert.equal(m.printed(), '-12|   34|000ab|ok|Z|%|77  X|FFFFFFFF|%q|5 6');
  assert.equal(n, m.printed().length, 'returns the number of characters');
});

test('ets_vprintf sends each character through the firmware routine it is given', () => {
  const m = machine();
  const log = [];
  m.guest(IRAM + 0x100, log, 'putc');
  m.str(RAM, 'a%db%sc%d');
  m.str(RAM + 0x40, 'XY');
  // GCC's Xtensa va_list: the first 24 bytes of arguments in the register save
  // area, the rest in the stack area from offset 32. Start at index 16, so the
  // first two values come from the save area and the third from the stack.
  const reg = RAM + 0x100, stk = RAM + 0x200;
  m.w32(reg + 16, 7);
  m.w32(reg + 20, RAM + 0x40);
  m.w32(stk + 32, 0xfffffffe);
  const n = m.call('ets_vprintf', IRAM + 0x100, RAM, stk, reg, 16);
  assert.equal(log.map((e) => String.fromCharCode(e[1])).join(''), 'a7bXYc-2');
  assert.equal(n, 8);
  assert.equal(m.printed(), '', 'nothing went to the ROM console');
  assert.equal(m.core.AR(0) >>> 0, 0x40100800, 'the caller\'s return address is back in a0');
});

test('ets_delay_us lets exactly that much simulated time pass', () => {
  const m = machine();
  const before = m.esp.clock.nanos;
  m.call('ets_delay_us', 1500);
  assert.ok(Math.abs(m.esp.clock.nanos - before - 1500000) < 100, `${m.esp.clock.nanos - before} ns passed`);
});

test('tasks: events are delivered highest priority first, oldest first; then the idle routine; then the core waits', () => {
  const m = machine();
  const log = [];
  m.guest(IRAM + 0x100, log, 'low');
  m.guest(IRAM + 0x110, log, 'high');
  m.guest(IRAM + 0x120, log, 'idle');
  const qLow = RAM + 0x100, qHigh = RAM + 0x200;
  m.call('ets_task', IRAM + 0x100, 3, qLow, 2);
  m.call('ets_task', IRAM + 0x110, 5, qHigh, 2);
  m.call('ets_set_idle_cb', IRAM + 0x120, 0xabc);
  assert.equal(m.call('ets_post_rom', 3, 11, 111), 0);
  assert.equal(m.call('ets_post_rom', 5, 21, 221), 0);
  assert.equal(m.call('ets_post_rom', 5, 22, 222), 0);
  assert.equal(m.call('ets_post_rom', 5, 23, 223), 1, 'a full queue refuses');
  assert.equal(m.call('ets_post_rom', 9, 1, 1), 1, 'so does a priority with no task');
  const events = [];
  for (const [name, at] of [['low', IRAM + 0x100], ['high', IRAM + 0x110]]) {
    const record = m.core.breakpoints[at];
    m.core.breakpoints[at] = (c) => {
      const p = c.AR(2) >>> 0;
      events.push([name, m.r32(p), m.r32(p + 4)]);
      return record(c);
    };
  }
  m.enter('ets_run');
  for (let i = 0; !m.core.idle; i++) {
    assert.ok(i < 1000, 'ets_run never came to rest');
    m.core.runInstruction();
  }
  assert.deepEqual(events, [['high', 21, 221], ['high', 22, 222], ['low', 11, 111]]);
  assert.deepEqual(log.map((e) => e[0]), ['high', 'high', 'low', 'idle']);
  assert.equal(log[3][1], 0xabc, 'the idle routine gets its argument');
  assert.equal(m.core.PC, WAIT_RESUME);
  assert.equal(m.core.PS_INTLEVEL, 0, 'interrupts are open while waiting');
});

test('an interrupt runs its service routine with level-1 interrupts masked, then the interrupted code goes on untouched', () => {
  const m = machine();
  const log = [];
  let levelInside = -1;
  m.guest(IRAM + 0x100, log, 'isr');
  const record = m.core.breakpoints[IRAM + 0x100];
  m.core.breakpoints[IRAM + 0x100] = (c) => {
    levelInside = c.PS_INTLEVEL;
    const go = record(c);
    for (let r = 3; r <= 11; r++) c.setAR(r, 0xdead0000 + r);   // a routine may trash these
    return go;
  };
  m.call('ets_isr_attach', 10, IRAM + 0x100, 0x1234);
  m.call('ets_isr_unmask', 1 << 10);
  for (let r = 2; r <= 15; r++) m.core.setAR(r, 0x1000 + r);
  m.core.setAR(0, HOME);
  m.core.PC = HOME;
  m.core.PS_INTLEVEL = 0;
  m.esp.interrupt(10, true);
  for (let i = 0; i < 6; i++) m.core.runInstruction();
  assert.deepEqual(log, [['isr', 0x1234, 0x1003]], 'called once, with its argument');
  assert.equal(levelInside, 1);
  assert.equal(m.core.PC, HOME);
  assert.equal(m.core.PS_INTLEVEL, 0);
  assert.equal(m.core.PS_EXCM, 0);
  for (let r = 2; r <= 15; r++) assert.equal(m.core.AR(r) >>> 0, 0x1000 + r, `a${r} restored`);
  assert.equal(m.rom.calls.get('(interrupt)'), 1);

  m.call('ets_isr_mask', 1 << 10);
  m.esp.interrupt(10, true);
  for (let i = 0; i < 4; i++) m.core.runInstruction();
  assert.equal(log.length, 1, 'a masked interrupt is not delivered');
});

test('an enabled interrupt with no service routine stops the run by number', () => {
  const m = machine();
  m.call('ets_isr_unmask', 1 << 5);
  m.core.setAR(0, HOME);
  m.core.PC = HOME;
  m.core.PS_INTLEVEL = 0;
  m.esp.interrupt(5, true);
  assert.throws(() => m.core.runInstruction(), (e) => e instanceof UnhandledException && /interrupt 5 with no service routine/.test(e.message));
});

test('an exception goes to the registered handler with a frame it can edit; with none it stops the run', () => {
  const m = machine();
  const sp = RAM + 0x1000;
  const raise = (cause, pc) => {
    m.core.setAR(1, sp);
    m.core.PC = pc;
    m.core.exception(cause);
    m.core.PC = m.core.nextPC;
  };
  raise(9, HOME);
  assert.throws(() => m.core.runInstruction(), (e) => e instanceof UnhandledException && e.cause_ === 9 && e.pc === HOME);

  const m2 = machine();
  let seen = null;
  m2.poke(IRAM + 0x100, RET_N);
  m2.core.breakpoints[IRAM + 0x100] = (c) => {
    const frame = c.AR(2) >>> 0;
    seen = { cause: c.AR(3) >>> 0, epc: m2.r32(frame), a5: m2.r32(frame + (3 + 5) * 4), frameCause: m2.r32(frame + 19 * 4) };
    m2.w32(frame, m2.r32(frame) + 3);            // skip the faulting instruction
    m2.w32(frame + (3 + 5) * 4, 0x5555);         // and give a5 a new value
    return false;
  };
  assert.equal(m2.call('_xtos_set_exception_handler', 3, IRAM + 0x100), 0, 'no previous handler');
  for (let r = 2; r <= 15; r++) m2.core.setAR(r, 0x2000 + r);
  m2.core.setAR(0, 0x40100900);
  m2.core.setAR(1, sp);
  m2.core.PC = IRAM + 0x840;
  m2.core.exception(3);
  m2.core.PC = m2.core.nextPC;
  for (let i = 0; i < 3; i++) m2.core.runInstruction();
  assert.deepEqual(seen, { cause: 3, epc: IRAM + 0x840, a5: 0x2005, frameCause: 3 });
  assert.equal(m2.core.PC, IRAM + 0x843, 'resumes where the edited frame says');
  assert.equal(m2.core.AR(5) >>> 0, 0x5555);
  assert.equal(m2.core.AR(6) >>> 0, 0x2006);
  assert.equal(m2.core.AR(1) >>> 0, sp);
  assert.equal(m2.core.AR(0) >>> 0, 0x40100900);
  assert.equal(m2.call('_xtos_set_exception_handler', 3, 0), IRAM + 0x100, 'returns the previous handler');
});

test('the dispatch table firmware vectors jump through leads into the same dispatcher', () => {
  const m = machine();
  for (const cause of [0, 4, 63]) assert.equal(m.r32(XTOS_TABLE + cause * 4), XTOS_ENTRIES + cause * 4);
  const log = [];
  m.guest(IRAM + 0x100, log, 'isr');
  m.call('ets_isr_attach', 10, IRAM + 0x100, 7);
  m.call('ets_isr_unmask', 1 << 10);
  // What the firmware's vector code leaves: a0 in EXCSAVE1, sp lowered by 0x100, a2..a4 in the frame.
  const sp = RAM + 0x1000;
  m.core.specialRegisters[177] = HOME;                 // EPC1
  m.core.specialRegisters[232] = 4;                    // EXCCAUSE: level-1 interrupt
  m.core.specialRegisters[226] |= 1 << 10;             // the interrupt is pending
  m.core.specialRegisters[209] = 0xa0a0a0a0;           // EXCSAVE1
  m.core.PS_EXCM = 1;
  m.core.setAR(1, sp - 0x100);
  m.w32(sp - 0x100 + 0x14, 0xa2);
  m.w32(sp - 0x100 + 0x18, 0xa3);
  m.w32(sp - 0x100 + 0x1c, 0xa4);
  m.core.PC = XTOS_ENTRIES + 4 * 4;
  for (let i = 0; i < 3; i++) m.core.runInstruction();
  assert.deepEqual(log.map((e) => e.slice(0, 2)), [['isr', 7]]);
  assert.equal(m.core.PC, HOME);
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => m.core.AR(r) >>> 0), [0xa0a0a0a0, sp, 0xa2, 0xa3, 0xa4]);
});
