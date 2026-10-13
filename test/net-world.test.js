/**
 * The simulated Wi-Fi world and the simulator's network device, driven at
 * the register level: no firmware runs here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ESP8266 } = require('../src/esp8266');
const { NetWorld } = require('../src/net/world');
const { BWNET_ID } = require('../src/peripherals/bwnet');

const NET = 0x60000c00;
const mac = (last) => Uint8Array.from([0x02, 0x62, 0x77, 0, 0, last]);
const frameTo = (dst, src, text) => Uint8Array.from([...dst, ...src, 0x88, 0xb5, ...Buffer.from(text)]);
const BROADCAST = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function board(world, last) {
  const esp = new ESP8266({ net: { world, mac: mac(last) } });
  const r = (off) => esp.mapAddress(NET + off).readUint32(NET + off) >>> 0;
  const w = (off, v) => esp.mapAddress(NET + off).writeUint32(NET + off, v >>> 0);
  const join = (ssid, password) => {
    w(0x04, 0); w(0x28, 0); w(0x2c, 0);
    for (const c of ssid) w(0x28, c.charCodeAt(0));
    for (const c of password) w(0x2c, c.charCodeAt(0));
    w(0x04, 1);
    return r(0x08);
  };
  const send = (frame) => {
    for (let i = 0; i < frame.length; i += 4) w(0x20, (frame[i] | (frame[i + 1] << 8) | (frame[i + 2] << 16) | (frame[i + 3] << 24)) >>> 0);
    w(0x24, frame.length);
  };
  const receive = () => {
    const length = r(0x14);
    if (!length) return null;
    const out = [];
    for (let i = 0; i < length; i += 4) { const word = r(0x18); for (let j = 0; j < 4 && i + j < length; j++) out.push((word >>> (8 * j)) & 0xff); }
    w(0x1c, 1);
    return Uint8Array.from(out);
  };
  return { esp, r, w, join, send, receive };
}

test('the device identifies itself and reports the address it was given', () => {
  const b = board(new NetWorld(), 0x2a);
  assert.equal(b.r(0x00), BWNET_ID);
  assert.equal(b.r(0x0c), 0x00776202);
  assert.equal(b.r(0x10), 0x2a00);
});

test('joining: the right name and password join, anything else is refused with the reason', () => {
  const world = new NetWorld();
  world.addAccessPoint('bw-world', 'brickwright');
  world.addAccessPoint('open');
  const b = board(world, 1);
  assert.equal(b.join('nowhere', '') & 0xd, 0x4, 'no such network');
  assert.equal(b.join('bw-world', 'wrong') & 0xd, 0x8, 'wrong password');
  assert.equal(world.networkOf(b.esp.net), null);
  assert.equal(b.join('bw-world', 'brickwright') & 0xd, 0x1);
  assert.equal(world.networkOf(b.esp.net), 'bw-world');
  assert.equal(b.join('open', '') & 0xd, 0x1);
  assert.equal(world.networkOf(b.esp.net), 'open', 'joining another network leaves the first');
  b.w(0x04, 0);
  assert.equal(world.networkOf(b.esp.net), null, 'clearing the join bit leaves');
  assert.equal(new ESP8266().net.readUint32(NET + 0x00), BWNET_ID, 'a board with no world still has the device');
  assert.equal(board(undefined, 2).join('bw-world', 'brickwright') & 0xd, 0x4, 'and finds no network');
});

test('delivery: unicast to its destination, broadcast to everyone else, nothing across networks or back to the sender', () => {
  const world = new NetWorld();
  world.addAccessPoint('a');
  world.addAccessPoint('b');
  const [x, y, z, other] = [board(world, 1), board(world, 2), board(world, 3), board(world, 4)];
  for (const m of [x, y, z]) m.join('a', '');
  other.join('b', '');
  x.send(frameTo(mac(2), mac(1), 'to y only'));
  assert.equal(Buffer.from(y.receive()).subarray(14).toString(), 'to y only');
  assert.equal(z.receive(), null);
  x.send(frameTo(BROADCAST, mac(1), 'all'));
  assert.equal(Buffer.from(y.receive()).subarray(14).toString(), 'all');
  assert.equal(Buffer.from(z.receive()).subarray(14).toString(), 'all');
  assert.equal(x.receive(), null, 'not back to the sender');
  assert.equal(other.receive(), null, 'not to another network');
  assert.equal(y.r(0x08) & 2, 0, 'nothing left waiting');
  assert.deepEqual(world.counters, { sent: 2, delivered: 3, refused: 0 });
});

test('frames wait in order, sixteen at most, and the loss is counted; a runt or a stranger\'s frame is refused', () => {
  const world = new NetWorld();
  world.addAccessPoint('a');
  const [x, y, stranger] = [board(world, 1), board(world, 2), board(world, 9)];
  x.join('a', ''); y.join('a', '');
  for (let i = 0; i < 18; i++) x.send(frameTo(mac(2), mac(1), `n${i}`));
  assert.equal(y.r(0x30), 2, 'two were dropped');
  assert.equal(Buffer.from(y.receive()).subarray(14).toString(), 'n0');
  assert.equal(Buffer.from(y.receive()).subarray(14).toString(), 'n1');
  x.send(Uint8Array.from([1, 2, 3]));
  stranger.send(frameTo(mac(2), mac(9), 'not a member'));
  assert.equal(world.counters.refused, 2);
});

test('a waiting frame raises the MAC interrupt only while the device is told to', () => {
  const world = new NetWorld();
  world.addAccessPoint('a');
  const [x, y] = [board(world, 1), board(world, 2)];
  x.join('a', ''); y.join('a', '');
  const pending = () => y.esp.cores[0].specialRegisters[226] & 1;
  x.send(frameTo(mac(2), mac(1), 'quiet'));
  assert.equal(pending(), 0, 'interrupt not enabled');
  y.w(0x04, 3);
  assert.equal(pending(), 1);
  y.receive();
  assert.equal(pending(), 0, 'gone once the frame is taken');
});

test('a host-side station takes part: it hears a board and answers it', () => {
  const world = new NetWorld();
  world.addAccessPoint('bw-world', 'brickwright');
  const heard = [];
  world.addStation('bw-world', mac(0xee), (frame, station) => {
    heard.push(Buffer.from(frame).subarray(14).toString());
    station.send(frameTo(frame.subarray(6, 12), station.mac, 'welcome'));
  }, 'brickwright');
  assert.throws(() => world.addStation('bw-world', mac(0xef), () => {}, 'nope'), /could not join "bw-world": wrong password/);
  const b = board(world, 1);
  b.join('bw-world', 'brickwright');
  b.send(frameTo(BROADCAST, mac(1), 'hello'));
  assert.deepEqual(heard, ['hello']);
  const reply = b.receive();
  assert.equal(Buffer.from(reply).subarray(14).toString(), 'welcome');
  assert.deepEqual([...reply.subarray(6, 12)], [...mac(0xee)]);
});
