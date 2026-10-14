const IMAGE_MAGIC = 0xe9;
/**
 * The stack pointer handed to the loaded image. The ROM's own value is not
 * known to this project; this is the top of data RAM, a choice that any
 * image which sets up its own stack does not depend on.
 */
export const BOOT_STACK = 0x3ffffff0;
export class NotAnImage extends Error {
    constructor(offset, found) {
        super(`no firmware image at flash offset 0x${offset.toString(16)}: ` +
            `expected the magic byte 0xe9, found 0x${found.toString(16)}`);
    }
}
/** Copy the segments of the image at `offset` in flash to their load addresses. */
export function loadImage(esp, offset = 0) {
    const { flash } = esp;
    const le32 = (at) => (flash[at] | (flash[at + 1] << 8) | (flash[at + 2] << 16) | (flash[at + 3] << 24)) >>> 0;
    if (flash[offset] !== IMAGE_MAGIC) {
        throw new NotAnImage(offset, flash[offset]);
    }
    const count = flash[offset + 1];
    const entry = le32(offset + 4);
    const segments = [];
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
export function seedRomData(esp) {
    const write = (addr, value) => esp.mapAddress(addr).writeUint32(addr, value >>> 0);
    write(ROM_FLASHCHIP_POINTER, ROM_FLASHCHIP);
    [0x001640ef, esp.flash.length, 0x10000, 0x1000, 0x100, 0xffff].forEach((value, i) => write(ROM_FLASHCHIP + i * 4, value));
}
/** Seed the ROM's variables, load the image at flash offset 0 and point the core at its entry. */
export function bootFromFlash(esp) {
    seedRomData(esp);
    const image = loadImage(esp, 0);
    const core = esp.cores[0];
    core.PC = image.entry;
    core.setAR(1, BOOT_STACK);
    // Firmware runs in user mode, so its exceptions and interrupts go to the
    // user vector. On the chip the ROM's start-up has set this before any image runs.
    core.PS_UM = 1;
    return image;
}
//# sourceMappingURL=boot.js.map