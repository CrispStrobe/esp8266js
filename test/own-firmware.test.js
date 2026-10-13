/**
 * Our own blob-free firmware, built from firmware/ with no SDK code, booted
 * without the ROM. Needs the built image: BW8266_BLINK=<blink.bin>. CI builds
 * it and requires this test to run; without the variable it skips by name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ESP8266 } = require('../src/esp8266');
const { RomHle } = require('../src/rom/rom-hle');
const { bootFromFlash } = require('../src/rom/boot');

const image = process.env.BW8266_BLINK;

test('blink: GPIO2 toggles every 500 ms of guest time and the serial port says so',
  { skip: image && fs.existsSync(image) ? false : 'set BW8266_BLINK to the built blink image' }, () => {
    const esp = new ESP8266();
    esp.flash.set(fs.readFileSync(image), 0);
    const rom = new RomHle(esp);
    rom.install();
    bootFromFlash(esp);
    const core = esp.cores[0];
    core.unknownInstruction = (op) => { throw new Error(`unknown instruction 0x${op.toString(16)} at 0x${core.PC.toString(16)}`); };
    let serial = '';
    esp.uart[0].onTX = (v) => { serial += String.fromCharCode(v); esp.uart[0].txComplete(); };
    const GPIO_OUT = 0x60000300, GPIO_ENABLE = 0x6000030c, LED = 1 << 2;
    const read = (a) => esp.mapAddress(a).readUint32(a) >>> 0;
    const edges = [];
    let level = read(GPIO_OUT) & LED;
    const until = 2.75e9;
    for (let i = 0; esp.clock.nanos < until; i++) {
      assert.ok(i < 4e8, 'the run did not reach 2.75 s of guest time');
      if (esp.coresIdle) esp.clock.skipToNextEvent(until);
      esp.step();
      if ((i & 0x1f) === 0) {
        const now = read(GPIO_OUT) & LED;
        if (now !== level) { level = now; edges.push([esp.clock.nanos / 1e6, now ? 1 : 0]); }
      }
    }
    assert.ok(read(GPIO_ENABLE) & LED, 'GPIO2 is an output');
    assert.deepEqual(edges.map((e) => e[1]), [1, 0, 1, 0, 1], 'on, off, on, off, on');
    edges.forEach(([ms], i) => assert.ok(Math.abs(ms - 500 * (i + 1)) < 2, `edge ${i} at ${ms.toFixed(2)} ms, expected ${500 * (i + 1)}`));
    assert.equal(serial, 'blink\non\noff\non\noff\non\n');
    assert.ok(rom.calls.get('(interrupt)') > 2700, `the timer interrupt ran ${rom.calls.get('(interrupt)')} times`);
    const radio = [...rom.calls.keys()].filter((k) => k.startsWith('(radio'));
    assert.deepEqual(radio, [], 'no radio routine is ever called');
  });
