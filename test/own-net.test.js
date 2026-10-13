/**
 * Our blob-free firmware on the simulated Wi-Fi world: two boards and a
 * host-side greeter on one access point. Needs the built image:
 * BW8266_NET=<net-hello.bin>. CI builds it and requires this test to run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ESP8266 } = require('../src/esp8266');
const { NetWorld } = require('../src/net/world');
const { RomHle } = require('../src/rom/rom-hle');
const { bootFromFlash } = require('../src/rom/boot');

const image = process.env.BW8266_NET;
const skip = image && fs.existsSync(image) ? false : 'set BW8266_NET to the built net-hello image';
const mac = (last) => Uint8Array.from([0x02, 0x62, 0x77, 0, 0, last]);

function boot(world, last) {
  const esp = new ESP8266({ net: { world, mac: mac(last) } });
  esp.flash.set(fs.readFileSync(image), 0);
  new RomHle(esp).install();
  bootFromFlash(esp);
  const core = esp.cores[0];
  core.unknownInstruction = (op) => { throw new Error(`unknown instruction 0x${op.toString(16)} at 0x${core.PC.toString(16)}`); };
  const board = { esp, serial: '' };
  esp.uart[0].onTX = (v) => { board.serial += String.fromCharCode(v); esp.uart[0].txComplete(); };
  return board;
}

/** Run the boards in turn, a slice of guest time each, until `ms` of guest time. */
function run(boards, ms) {
  for (let t = 0.1; t <= ms; t += 0.1) {
    for (const b of boards) while (b.esp.clock.nanos < t * 1e6) b.esp.step();
  }
}

test('two boards and a greeter on one network hear each other', { skip }, () => {
  const world = new NetWorld();
  world.addAccessPoint('bw-world', 'brickwright');
  const greeted = new Set();
  world.addStation('bw-world', mac(0xee), (frame, station) => {
    const from = frame[11];
    if (greeted.has(from)) return;
    greeted.add(from);
    station.send(Uint8Array.from([...frame.subarray(6, 12), ...station.mac, 0x88, 0xb5, ...Buffer.from('welcome')]));
  }, 'brickwright');
  const a = boot(world, 0x0a), b = boot(world, 0x0b);
  run([a, b], 450);
  for (const [me, peer] of [[a, '0b'], [b, '0a']]) {
    const lines = me.serial.split('\n');
    assert.equal(lines[0], 'joined');
    assert.equal(lines.filter((l) => l === 'rx welcome').length, 1, 'greeted once, by unicast');
    assert.equal(lines.filter((l) => l === `rx hello from ${peer}`).length, 2, 'the peer\'s hello at 200 and 400 ms');
    assert.ok(!lines.some((l) => l.startsWith('rx hello from') && !l.endsWith(peer)), 'never its own hello');
  }
  assert.deepEqual([...greeted].sort(), [0x0a, 0x0b]);
});

test('a board is told why it could not join', { skip }, () => {
  const wrong = new NetWorld();
  wrong.addAccessPoint('bw-world', 'something else');
  const a = boot(wrong, 1);
  run([a], 5);
  assert.equal(a.serial, 'join refused: wrong password\n');
  const empty = boot(new NetWorld(), 2);
  run([empty], 5);
  assert.equal(empty.serial, 'join refused: no such network\n');
});
