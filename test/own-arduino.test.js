/**
 * Sketches written against the Arduino-style layer (firmware/arduino), built
 * with no Arduino core and no SDK, booted without the ROM. Needs the built
 * images: BW8266_BUTTON, BW8266_PULSE and BW8266_WAVE. CI builds them and requires these
 * tests to run; without the variables they skip by name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ESP8266 } = require('../src/esp8266');
const { RomHle } = require('../src/rom/rom-hle');
const { bootFromFlash } = require('../src/rom/boot');

const images = { button: process.env.BW8266_BUTTON, pulse: process.env.BW8266_PULSE, wave: process.env.BW8266_WAVE };
const skip = (name) => (images[name] && fs.existsSync(images[name]) ? false : `set BW8266_${name.toUpperCase()} to the built ${name} image`);

function boot(name, before) {
  const esp = new ESP8266();
  esp.flash.set(fs.readFileSync(images[name]), 0);
  const rom = new RomHle(esp);
  rom.install();
  if (before) before(esp);
  bootFromFlash(esp);
  const core = esp.cores[0];
  core.unknownInstruction = (op) => { throw new Error(`unknown instruction 0x${op.toString(16)} at 0x${core.PC.toString(16)}`); };
  const board = { esp, rom, serial: '' };
  esp.uart[0].onTX = (v) => { board.serial += String.fromCharCode(v); esp.uart[0].txComplete(); };
  /** Run until `ms` of guest time. */
  board.until = (ms) => {
    for (let i = 0; esp.clock.nanos < ms * 1e6; i++) {
      assert.ok(i < 2e8, `did not reach ${ms} ms of guest time`);
      esp.step();
    }
  };
  board.out = (pin) => (esp.mapAddress(0x60000300).readUint32(0x60000300) >>> pin) & 1;
  board.outputEnabled = (pin) => (esp.mapAddress(0x6000030c).readUint32(0x6000030c) >>> pin) & 1;
  return board;
}

test('a sketch: the LED follows the button, presses are counted by interrupt, and setup shifted a byte out',
  { skip: skip('button') }, () => {
    const shifted = [];
    const b = boot('button', (esp) => {
      esp.gpio.pins[5].inputValue = true;                     // released: the pull-up holds it high
      // What a shift register sees: the data line at each rising clock edge.
      let clock = 0;
      const sample = () => {
        const out = esp.mapAddress(0x60000300).readUint32(0x60000300);
        const now = (out >>> 14) & 1;
        if (now && !clock) shifted.push((out >>> 4) & 1);
        clock = now;
      };
      const gpio = esp.gpio;
      const write = gpio.writeUint32.bind(gpio);
      gpio.writeUint32 = (addr, value) => { write(addr, value); sample(); };
    });
    b.until(10);
    assert.equal(b.serial, 'ready\n');
    assert.deepEqual(shifted, [1, 0, 1, 0, 0, 1, 0, 1], '0xA5, most significant bit first');
    assert.deepEqual([b.outputEnabled(2), b.outputEnabled(5), b.out(2)], [1, 0, 1], 'LED is an output and on; the button is an input');
    b.esp.gpio.pins[5].inputValue = false;                    // pressed
    b.until(20);
    assert.equal(b.out(2), 0, 'the LED follows the button down');
    assert.equal(b.serial, 'ready\npress\n');
    b.esp.gpio.pins[5].inputValue = true;                     // released: a rising edge, not counted
    b.until(30);
    assert.deepEqual([b.out(2), b.serial], [1, 'ready\npress\n']);
    b.esp.gpio.pins[5].inputValue = false;
    b.until(40);
    assert.equal(b.serial, 'ready\npress\npress\n');
    assert.ok(b.rom.calls.get('(interrupt)') > 30, 'the millisecond tick and the pin interrupts ran');
  });

test('pulseIn measures a pulse on a pin in guest time', { skip: skip('pulse') }, () => {
  const b = boot('pulse');
  b.until(5);
  assert.equal(b.serial, 'ready\n');
  for (const [at, width] of [[10, 2], [20, 5.5]]) {
    b.until(at);
    b.esp.gpio.pins[5].inputValue = true;
    b.until(at + width);
    b.esp.gpio.pins[5].inputValue = false;
  }
  b.until(40);
  assert.equal(b.serial, 'ready\npulse 2000\npulse 5500\n');
});

test('analogWrite and tone make their waveforms on the first hardware timer', { skip: skip('wave') }, () => {
  const edges = { 4: [], 5: [] };
  const b = boot('wave', (esp) => {
    let last = 0;
    const gpio = esp.gpio;
    const write = gpio.writeUint32.bind(gpio);
    gpio.writeUint32 = (addr, value) => {
      write(addr, value);
      const out = esp.mapAddress(0x60000300).readUint32(0x60000300);
      for (const pin of [4, 5]) {
        const level = (out >>> pin) & 1;
        if (level !== ((last >>> pin) & 1)) edges[pin].push([esp.clock.nanos / 1e3, level]);
      }
      last = out;
    };
  });
  b.until(40);
  assert.equal(b.serial, 'ready\n');
  // PWM: rising edges 1000 microseconds apart, high for 64/255 of the period.
  const rises = edges[4].filter(([, l]) => l === 1).map(([t]) => t);
  assert.ok(rises.length >= 35, `${rises.length} PWM periods in 40 ms`);
  for (let i = 1; i < rises.length; i++) assert.ok(Math.abs(rises[i] - rises[i - 1] - 1000) < 20, `period ${rises[i] - rises[i - 1]}`);
  const highs = edges[4].map(([t, l], i) => (l === 1 && edges[4][i + 1] ? edges[4][i + 1][0] - t : null)).filter((w) => w !== null);
  for (const w of highs) assert.ok(Math.abs(w - 251) < 20, `high for ${w} microseconds`);
  // tone: 1 kHz for 20 milliseconds, then low and quiet.
  const toneRises = edges[5].filter(([, l]) => l === 1).map(([t]) => t);
  assert.ok(toneRises.length >= 19 && toneRises.length <= 21, `${toneRises.length} tone periods`);
  for (let i = 1; i < toneRises.length; i++) assert.ok(Math.abs(toneRises[i] - toneRises[i - 1] - 1000) < 20);
  const lastEdge = edges[5][edges[5].length - 1];
  assert.equal(lastEdge[1], 0, 'the tone ends low');
  assert.ok(lastEdge[0] < 23000, `the tone stopped at ${lastEdge[0]} microseconds`);
});
