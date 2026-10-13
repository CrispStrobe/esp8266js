/**
 * The first hardware timer (FRC1), at register level: a 23-bit down counter
 * with a prescaler, reload and a zero interrupt. No firmware runs here; time
 * is moved by the simulation clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ESP8266 } = require('../src/esp8266');

const LOAD = 0x60000600, COUNT = 0x60000604, CTRL = 0x60000608, INT = 0x6000060c;
const ENABLE = 1 << 7, AUTOLOAD = 1 << 6, DIV16 = 2 << 1, DIV256 = 4 << 1, STATUS = 1 << 8;

function machine() {
  const esp = new ESP8266();
  const r = (a) => esp.mapAddress(a).readUint32(a) >>> 0;
  const w = (a, v) => esp.mapAddress(a).writeUint32(a, v >>> 0);
  /** Let `us` microseconds of simulated time pass, running whatever falls due. */
  const pass = (us) => {
    const target = esp.cycles + Math.round(us * 80);       // the clock runs at 80 MHz
    const deadline = (target / 80e6) * 1e9;
    for (let guard = 0; esp.cycles < target; guard++) {
      assert.ok(guard < 100000, 'time does not pass');
      const before = esp.cycles;
      esp.clock.skipToNextEvent(deadline);
      if (esp.cycles === before) esp.cycles = Math.min(target, before + 1);
    }
  };
  const pending = () => (esp.cores[0].specialRegisters[226] >>> 9) & 1;
  return { esp, r, w, pass, pending };
}

test('it counts down from the loaded value at the prescaled rate, and only while enabled', () => {
  const m = machine();
  m.w(LOAD, 10000);
  m.pass(500);
  assert.equal(m.r(COUNT), 10000, 'not enabled: it stays where it was loaded');
  m.w(CTRL, ENABLE | DIV16);                         // 80 MHz / 16 = 5 ticks per microsecond
  m.pass(500);
  assert.equal(m.r(COUNT), 10000 - 2500);
  m.w(CTRL, DIV16);                                  // stopped
  m.pass(500);
  assert.equal(m.r(COUNT), 7500, 'stopped: the value is kept');
  m.w(CTRL, ENABLE | DIV256);                        // 0.3125 ticks per microsecond
  m.pass(3200);
  assert.equal(m.r(COUNT), 7500 - 1000);
  assert.equal(m.r(LOAD), 10000);
});

test('at zero it raises interrupt 9 and, with autoload, starts again from the loaded value', () => {
  const m = machine();
  m.w(LOAD, 5000);                                   // 1 ms at divide-by-16
  m.w(CTRL, ENABLE | AUTOLOAD | DIV16);
  m.pass(999);
  assert.deepEqual([m.pending(), m.r(CTRL) & STATUS], [0, 0], 'not yet');
  m.pass(2);
  assert.deepEqual([m.pending(), m.r(CTRL) & STATUS, m.r(INT)], [1, STATUS, 1]);
  assert.ok(m.r(COUNT) > 4990 && m.r(COUNT) <= 5000, `reloaded: ${m.r(COUNT)}`);
  m.w(INT, 1);
  assert.deepEqual([m.pending(), m.r(CTRL) & STATUS, m.r(INT)], [0, 0, 0], 'acknowledged');
  m.pass(1000);
  assert.equal(m.pending(), 1, 'and again one period later');
  let zeros = 0;
  for (let i = 0; i < 5; i++) { m.w(INT, 1); m.pass(1000); zeros += m.pending(); }
  assert.equal(zeros, 5, 'once per period');
});

test('without autoload it wraps to the top of its 23 bits and keeps counting', () => {
  const m = machine();
  m.w(LOAD, 100);
  m.w(CTRL, ENABLE | DIV16);
  m.pass(21);                                        // 105 ticks: zero at tick 100
  assert.equal(m.pending(), 1);
  assert.equal(m.r(COUNT), 0x800000 - 5, 'five ticks into the next full turn');
  assert.ok(m.r(COUNT) <= 0x7fffff, 'never more than 23 bits');
});

test('writing the control register keeps the interrupt status, which only INT clears', () => {
  const m = machine();
  m.w(LOAD, 10);
  m.w(CTRL, ENABLE | DIV16);
  m.pass(5);
  assert.equal(m.r(CTRL) & STATUS, STATUS);
  m.w(CTRL, ENABLE | AUTOLOAD | DIV16);
  assert.equal(m.r(CTRL) & STATUS, STATUS, 'a control write does not clear it');
  m.w(INT, 0);
  assert.equal(m.r(CTRL) & STATUS, STATUS, 'nor does writing 0 to INT');
  m.w(INT, 1);
  assert.equal(m.r(CTRL) & STATUS, 0);
});
