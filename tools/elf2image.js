#!/usr/bin/env node
/**
 * Turn a linked ELF into an ESP8266 flash image (the format the ROM boots):
 *   header   0xE9, segment count, flash mode, size/frequency, entry (LE32)
 *   segment  load address, length (both LE32), data padded to 4 bytes
 *   padding to a 16-byte boundary, whose last byte is the checksum
 *            (0xEF XOR every data byte)
 *
 *   node tools/elf2image.js program.elf program.bin
 */
const fs = require('fs');

function elf2image(elf) {
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 1 || elf[5] !== 1) {
    throw new Error('not a 32-bit little-endian ELF');
  }
  const entry = elf.readUInt32LE(24);
  const phoff = elf.readUInt32LE(28);
  const phentsize = elf.readUInt16LE(42);
  const phnum = elf.readUInt16LE(44);
  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    const type = elf.readUInt32LE(at);
    const offset = elf.readUInt32LE(at + 4);
    const address = elf.readUInt32LE(at + 12);
    const filesz = elf.readUInt32LE(at + 16);
    if (type !== 1 || filesz === 0) continue;
    const data = Buffer.alloc((filesz + 3) & ~3);
    elf.copy(data, 0, offset, offset + filesz);
    segments.push({ address, data });
  }
  if (!segments.length || segments.length > 255) throw new Error(`${segments.length} loadable segments`);
  const parts = [Buffer.from([0xe9, segments.length, 0, 0, 0, 0, 0, 0])];
  parts[0].writeUInt32LE(entry, 4);
  let checksum = 0xef;
  for (const { address, data } of segments) {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(address, 0);
    head.writeUInt32LE(data.length, 4);
    parts.push(head, data);
    for (const b of data) checksum ^= b;
  }
  const length = parts.reduce((n, p) => n + p.length, 0);
  const tail = Buffer.alloc(16 - (length % 16));
  tail[tail.length - 1] = checksum;
  parts.push(tail);
  return { image: Buffer.concat(parts), entry, segments: segments.map((s) => [s.address, s.data.length]) };
}

module.exports = { elf2image };

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: elf2image.js <program.elf> <program.bin>');
    process.exit(2);
  }
  const out = elf2image(fs.readFileSync(input));
  fs.writeFileSync(output, out.image);
  console.log(`entry 0x${out.entry.toString(16)}; segments ${out.segments.map(([a, n]) => `0x${a.toString(16)}+${n}`).join(', ')}; ${out.image.length} bytes`);
}
