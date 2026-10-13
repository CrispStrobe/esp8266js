/**
 * tools/elf2image.js: RAM segments go into the boot image at offset 0,
 * flash-mapped segments to their flash offset in the same file. The ELF files
 * here are built by hand, with nothing but program headers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { elf2image } = require('../tools/elf2image');
const { ESP8266 } = require('../src/esp8266');
const { bootFromFlash } = require('../src/rom/boot');

/** A minimal ELF32 little-endian executable with one PT_LOAD per segment. */
function makeElf(entry, segments) {
  const headers = 52 + 32 * segments.length;
  const elf = Buffer.alloc(headers + segments.reduce((n, s) => n + s.data.length, 0));
  elf.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
  elf.writeUInt16LE(2, 16); // executable
  elf.writeUInt16LE(94, 18); // Xtensa
  elf.writeUInt32LE(1, 20);
  elf.writeUInt32LE(entry, 24);
  elf.writeUInt32LE(52, 28); // program headers follow the ELF header
  elf.writeUInt16LE(52, 40);
  elf.writeUInt16LE(32, 42);
  elf.writeUInt16LE(segments.length, 44);
  let offset = headers;
  segments.forEach(({ address, data }, i) => {
    const at = 52 + 32 * i;
    elf.writeUInt32LE(1, at); // PT_LOAD
    elf.writeUInt32LE(offset, at + 4);
    elf.writeUInt32LE(address, at + 8);
    elf.writeUInt32LE(address, at + 12);
    elf.writeUInt32LE(data.length, at + 16);
    elf.writeUInt32LE(data.length, at + 20);
    Buffer.from(data).copy(elf, offset);
    offset += data.length;
  });
  return elf;
}

const ram = { address: 0x40100000, data: [1, 2, 3, 4, 5, 6, 7, 8] };
const data = { address: 0x3ffe8000, data: [9, 10, 11] };

test('elf2image: an ELF with only RAM segments gives the boot image alone', () => {
  const out = elf2image(makeElf(0x40100000, [ram, data]));
  assert.deepEqual(out.segments, [[0x40100000, 8], [0x3ffe8000, 4]]);
  assert.deepEqual(out.mapped, []);
  assert.equal(out.image.length, out.bootLength);
  assert.equal(out.image.length % 16, 0);
  assert.equal(out.image[0], 0xe9);
  assert.equal(out.image[1], 2);
  assert.equal(out.image.readUInt32LE(4), 0x40100000);
  const checksum = [...ram.data, ...data.data].reduce((x, b) => x ^ b, 0xef);
  assert.equal(out.image[out.image.length - 1], checksum);
});

test('elf2image: a flash-mapped segment lands at its flash offset, and the simulator runs from there', () => {
  const irom = { address: 0x40210000, data: [0xaa, 0xbb, 0xcc, 0xdd, 0xee] };
  const out = elf2image(makeElf(0x40100000, [irom, ram, data]));
  assert.deepEqual(out.segments, [[0x40100000, 8], [0x3ffe8000, 4]], 'the boot image has the RAM segments only');
  assert.deepEqual(out.mapped, [[0x40210000, 8, 0x10000]]);
  assert.equal(out.image.length, 0x10008);
  assert.deepEqual([...out.image.subarray(0x10000, 0x10005)], irom.data);
  assert.ok(out.image.subarray(out.bootLength, 0x10000).every((b) => b === 0xff), 'erased flash in between');

  // Written to the simulated flash, the boot image loads and the mapped bytes are where they were linked.
  const esp = new ESP8266();
  esp.flash.set(out.image, 0);
  const loaded = bootFromFlash(esp);
  assert.equal(loaded.entry, 0x40100000);
  assert.equal(loaded.segments.length, 2);
  assert.equal(esp.mapAddress(0x40100004).readUint8(0x40100004), 5);
  assert.equal(esp.mapAddress(0x40210000).readUint32(0x40210000) >>> 0, 0xddccbbaa);
});

test('elf2image: overlapping pieces of flash are an error that says which', () => {
  const big = { address: 0x40100000, data: new Array(0x800).fill(0x55) };
  assert.throws(
    () => elf2image(makeElf(0x40100000, [big, { address: 0x40200400, data: [1, 2, 3, 4] }])),
    /flash-mapped segment at 0x40200400 \(flash offset 0x400\) overlaps the boot image \(2080 bytes from flash offset 0\)/
  );
  assert.throws(
    () => elf2image(makeElf(0x40100000, [ram, { address: 0x40210000, data: new Array(16).fill(1) }, { address: 0x40210008, data: [2, 2, 2, 2] }])),
    /flash-mapped segment at 0x40210008 .* overlaps the flash-mapped segment at 0x40210000/
  );
  assert.throws(
    () => elf2image(makeElf(0x40100000, [ram, { address: 0x402ffffc, data: new Array(8).fill(1) }])),
    /runs past the mapped megabyte/
  );
  assert.throws(() => elf2image(makeElf(0x40210000, [{ address: 0x40210000, data: [1] }])), /0 loadable RAM segments/);
});
