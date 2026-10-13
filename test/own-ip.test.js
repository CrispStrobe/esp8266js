/**
 * Our blob-free firmware with a real TCP/IP stack (lwIP) on the simulated
 * Wi-Fi world: firmware/net-ip.c gets an address by DHCP, resolves a name by
 * DNS and fetches a page over TCP. The other end is test scaffolding
 * (helpers/ip-responder.js), a host-side station of the same access point.
 * Needs the built image: BW8266_IP=<net-ip.bin>. CI builds it and requires
 * this test to run; without the variable it skips by name.
 *
 * The network, chosen here: 10.0.0.0/24. The responder is 10.0.0.2 (DHCP
 * server, router, DNS server and the web server "museum.lan" in one); the
 * board is given 10.0.0.100.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ESP8266 } = require('../src/esp8266');
const { NetWorld } = require('../src/net/world');
const { RomHle } = require('../src/rom/rom-hle');
const { bootFromFlash } = require('../src/rom/boot');
const { IpResponder } = require('./helpers/ip-responder');

const image = process.env.BW8266_IP;
const skip = image && fs.existsSync(image) ? false : 'set BW8266_IP to the built net-ip image';
const mac = (last) => Uint8Array.from([0x02, 0x62, 0x77, 0, 0, last]);

/** Guest time allowed for the whole exchange. The firmware's own step time-outs (10 to 15 s) report first. */
const LIMIT_MS = 30000;
/** Guest time run after "done", for the closing handshake and to see that nothing more is printed. */
const AFTER_MS = 50;

test('net-ip: DHCP, DNS and an HTTP exchange over TCP through lwIP', { skip }, () => {
  const world = new NetWorld();
  world.addAccessPoint('bw-world', 'brickwright');
  const responder = new IpResponder({
    mac: mac(0xfe),
    ip: '10.0.0.2',
    clientIp: '10.0.0.100',
    netmask: '255.255.255.0',
    name: 'museum.lan',
    body: ({ path, host }) => (path === '/hall' ? `welcome to ${host}${path}\nthe second line is not printed\n` : null),
  }).attach(world, 'bw-world', 'brickwright');

  const esp = new ESP8266({ net: { world, mac: mac(0x1a) } });
  esp.flash.set(fs.readFileSync(image), 0);
  const rom = new RomHle(esp);
  rom.install();
  bootFromFlash(esp);
  const core = esp.cores[0];
  const at = () => `at 0x${core.PC.toString(16)}`;
  core.unknownInstruction = (op) => { throw new Error(`unknown instruction 0x${op.toString(16)} ${at()}`); };
  core.unimplemented = (op, name) => { throw new Error(`unimplemented instruction ${name ?? ''} 0x${op.toString(16)} ${at()}`); };
  let serial = '';
  esp.uart[0].onTX = (v) => { serial += String.fromCharCode(v); esp.uart[0].txComplete(); };

  const runUntil = (nanos, stop) => {
    while (esp.clock.nanos < nanos && !stop()) {
      if (esp.coresIdle) esp.clock.skipToNextEvent(nanos);
      esp.step();
    }
  };
  runUntil(LIMIT_MS * 1e6, () => serial.endsWith('done\n') || /error:.*\n/.test(serial));
  const finished = esp.clock.nanos / 1e6;
  runUntil((finished + AFTER_MS) * 1e6, () => false);

  const context = `serial ${JSON.stringify(serial)} after ${finished.toFixed(1)} ms of guest time; ` +
    `the responder saw ${JSON.stringify(responder.log)}, problems ${JSON.stringify(responder.problems)}`;
  assert.equal(
    serial,
    'ip 10.0.0.100\ndns museum.lan -> 10.0.0.2\nhttp welcome to museum.lan/hall\ndone\n',
    context
  );
  assert.ok(finished < LIMIT_MS, context);
  assert.deepEqual(responder.problems, [], 'every frame from the board was well-formed, with correct checksums');
  assert.deepEqual(responder.log, [
    'dhcp discover',
    'dhcp request 10.0.0.100',
    'arp who-has 10.0.0.2 from 10.0.0.100',
    'dns A museum.lan',
    'tcp syn',
    'tcp established',
    'http GET /hall host museum.lan',
    'tcp our fin acknowledged',
    'tcp fin from the client',
    'tcp closed',
  ]);
  assert.equal(responder.connections.size, 0, 'the connection was closed from both sides');
  assert.equal(rom.calls.get('Cache_Read_Enable'), 1, 'flash was mapped once, at start-up');
  assert.ok(rom.calls.get('(interrupt)') > 0, 'the millisecond clock ran');
  const radio = [...rom.calls.keys()].filter((k) => k.startsWith('(radio'));
  assert.deepEqual(radio, [], 'no radio routine is ever called');
});
