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
/**
 * The stack pointer handed to the loaded image. The ROM's own value is not
 * known to this project; this is the top of data RAM, a choice that any
 * image which sets up its own stack does not depend on.
 */
export declare const BOOT_STACK = 1073741808;
export interface ILoadedImage {
    entry: number;
    segments: Array<{
        address: number;
        length: number;
    }>;
}
export declare class NotAnImage extends Error {
    constructor(offset: number, found: number);
}
/** Copy the segments of the image at `offset` in flash to their load addresses. */
export declare function loadImage(esp: ESP8266, offset?: number): ILoadedImage;
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
export declare const ROM_FLASHCHIP_POINTER = 1073727252;
export declare function seedRomData(esp: ESP8266): void;
/** Seed the ROM's variables, load the image at flash offset 0 and point the core at its entry. */
export declare function bootFromFlash(esp: ESP8266): ILoadedImage;
