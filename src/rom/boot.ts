/**
 * Start firmware from flash without the mask ROM.
 *
 * On the chip, the ROM's reset code reads the image at flash offset 0, copies
 * its segments to RAM and jumps to its entry point (for an Arduino build that
 * image is the second-stage loader, which then loads the sketch the same way,
 * through ROM flash routines). This does the first of those steps in the host.
 *
 * The image format is Espressif's public one (esptool's documentation):
 *   header   0xE9, segment count, flash mode, size/frequency, entry (LE32)
 *   segment  load address (LE32), length (LE32), data
 * The trailing checksum is not checked.
 */
import { ESP8266 } from '../esp8266';

const IMAGE_MAGIC = 0xe9;

/**
 * The stack pointer handed to the loaded image. The ROM's own value is not
 * known to this project; this is the top of data RAM, a choice that any
 * image which sets up its own stack does not depend on.
 */
export const BOOT_STACK = 0x3ffffff0;

export interface ILoadedImage {
  entry: number;
  segments: Array<{ address: number; length: number }>;
}

export class NotAnImage extends Error {
  constructor(offset: number, found: number) {
    super(
      `no firmware image at flash offset 0x${offset.toString(16)}: ` +
        `expected the magic byte 0xe9, found 0x${found.toString(16)}`
    );
  }
}

/** Copy the segments of the image at `offset` in flash to their load addresses. */
export function loadImage(esp: ESP8266, offset = 0): ILoadedImage {
  const { flash } = esp;
  const le32 = (at: number) =>
    (flash[at] | (flash[at + 1] << 8) | (flash[at + 2] << 16) | (flash[at + 3] << 24)) >>> 0;
  if (flash[offset] !== IMAGE_MAGIC) {
    throw new NotAnImage(offset, flash[offset]);
  }
  const count = flash[offset + 1];
  const entry = le32(offset + 4);
  const segments: ILoadedImage['segments'] = [];
  let at = offset + 8;
  for (let i = 0; i < count; i++) {
    const address = le32(at);
    const length = le32(at + 4);
    at += 8;
    if (at + length > flash.length) {
      throw new Error(`segment ${i} of the image at 0x${offset.toString(16)} runs past the flash`);
    }
    for (let j = 0; j < length; j++) {
      esp.mapAddress(address + j).writeUint8(address + j, flash[at + j]);
    }
    segments.push({ address, length });
    at += length;
  }
  return { entry, segments };
}

/**
 * ROM variables firmware reads directly. The ROM keeps its own data in RAM
 * (0x3fffc000 upward) and the SDK's linker script names some of it; an image
 * that reads one of these without the ROM having run finds zeros.
 *
 * Provided: `flashchip` (0x3fffc714), a pointer to the flash description
 * { device id, chip size, block size, sector size, page size, status mask }
 * of the SDK's spi_flash.h. The sizes describe the simulated flash; the
 * device id is a placeholder, not a real part's.
 *
 * Not provided, and not detectable when read: the AES tables `Te0` and
 * `rcons` (used by the radio stack's cryptography) and `user_start_fptr`.
 */
export const ROM_FLASHCHIP_POINTER = 0x3fffc714;
const ROM_FLASHCHIP = 0x3fffc718;

export function seedRomData(esp: ESP8266) {
  const write = (addr: number, value: number) => esp.mapAddress(addr).writeUint32(addr, value >>> 0);
  write(ROM_FLASHCHIP_POINTER, ROM_FLASHCHIP);
  [0x001640ef, esp.flash.length, 0x10000, 0x1000, 0x100, 0xffff].forEach((value, i) =>
    write(ROM_FLASHCHIP + i * 4, value)
  );
}

/** Seed the ROM's variables, load the image at flash offset 0 and point the core at its entry. */
export function bootFromFlash(esp: ESP8266): ILoadedImage {
  seedRomData(esp);
  const image = loadImage(esp, 0);
  const core = esp.cores[0];
  core.PC = image.entry;
  core.setAR(1, BOOT_STACK);
  return image;
}
