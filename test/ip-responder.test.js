/**
 * The host-side responder the net-ip test talks to (helpers/ip-responder.js)
 * is scaffolding, but a wrong checksum in it would look like a firmware
 * fault. These checks need no firmware: frames are handed to it directly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { NetWorld } = require('../src/net/world');
const { IpResponder, checksum } = require('./helpers/ip-responder');

const mac = (last) => Uint8Array.from([0x02, 0x62, 0x77, 0, 0, last]);
const be16 = (b, at) => (b[at] << 8) | b[at + 1];

function setUp() {
  const world = new NetWorld();
  world.addAccessPoint('bw-world');
  const responder = new IpResponder({
    mac: mac(0xfe), ip: '10.0.0.2', clientIp: '10.0.0.100', netmask: '255.255.255.0', name: 'museum.lan',
    body: () => 'hello\n',
  }).attach(world, 'bw-world');
  const heard = [];
  const client = world.addStation('bw-world', mac(1), (frame) => heard.push(frame));
  return { responder, client, heard };
}

test('ip-responder: the Internet checksum matches the worked example of RFC 1071', () => {
  // RFC 1071, section 3: the words 0001 f203 f4f5 f6f7 sum to ddf2, so the checksum is 220d.
  assert.equal(checksum([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7]), 0x220d);
  // A message with its checksum in place sums to zero; an odd length is padded with a zero byte.
  assert.equal(checksum([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7, 0x22, 0x0d]), 0);
  assert.equal(checksum([0x12]), ~0x1200 & 0xffff);
});

test('ip-responder: answers ARP for its own address only, and a TCP SYN with a SYN-ACK whose checksums hold', () => {
  const { responder, client, heard } = setUp();
  const arp = (target) => Uint8Array.from([
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...client.mac, 0x08, 0x06,
    0, 1, 0x08, 0x00, 6, 4, 0, 1, ...client.mac, 10, 0, 0, 100, 0, 0, 0, 0, 0, 0, ...target,
  ]);
  client.send(arp([10, 0, 0, 7]));
  assert.equal(heard.length, 0, 'not its address: silence');
  client.send(arp([10, 0, 0, 2]));
  assert.equal(heard.length, 1);
  const reply = heard[0];
  assert.deepEqual([...reply.subarray(0, 6)], [...client.mac]);
  assert.equal(be16(reply, 20), 2, 'an ARP reply');
  assert.deepEqual([...reply.subarray(22, 32)], [...mac(0xfe), 10, 0, 0, 2]);

  // SYN from 10.0.0.100:49152 to 10.0.0.2:80, sequence 1000.
  const tcp = [0xc0, 0x00, 0, 80, 0, 0, 0x03, 0xe8, 0, 0, 0, 0, 0x50, 0x02, 0x10, 0x00, 0, 0, 0, 0];
  const pseudo = [10, 0, 0, 100, 10, 0, 0, 2, 0, 6, 0, tcp.length];
  const sum = checksum([...pseudo, ...tcp]);
  tcp[16] = sum >> 8;
  tcp[17] = sum & 0xff;
  const ip = [0x45, 0, 0, 20 + tcp.length, 0, 1, 0x40, 0, 64, 6, 0, 0, 10, 0, 0, 100, 10, 0, 0, 2];
  const ipSum = checksum(ip);
  ip[10] = ipSum >> 8;
  ip[11] = ipSum & 0xff;
  client.send(Uint8Array.from([...mac(0xfe), ...client.mac, 0x08, 0x00, ...ip, ...tcp]));
  assert.deepEqual(responder.problems, []);
  assert.equal(heard.length, 2);
  const answer = heard[1].subarray(14);
  assert.equal(checksum(answer.subarray(0, 20)), 0, 'IPv4 header checksum');
  const segment = answer.subarray(20, be16(answer, 2));
  assert.equal(checksum([...answer.subarray(12, 20), 0, 6, 0, segment.length, ...segment]), 0, 'TCP checksum');
  assert.equal(segment[13], 0x12, 'SYN and ACK');
  assert.equal(((segment[8] << 24) | (segment[9] << 16) | (segment[10] << 8) | segment[11]) >>> 0, 1001, 'acknowledges the SYN');

  // The same SYN with one bit of its checksum flipped is refused and reported.
  const bad = Uint8Array.from([...mac(0xfe), ...client.mac, 0x08, 0x00, ...ip, ...tcp]);
  bad[14 + 20 + 17] ^= 1;
  client.send(bad);
  assert.equal(heard.length, 2);
  assert.deepEqual(responder.problems, ['a TCP segment with a wrong checksum']);
});
