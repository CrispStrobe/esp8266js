/**
 * Entry points of the ESP8266 mask ROM that stock Arduino sketches link
 * against: name -> address.
 *
 * Measured, not copied from a ROM: these are the ROM-window symbols
 * (0x40000000-0x4000ffff) of three sketches built with the Arduino ESP8266
 * core 3.1.2 (census/, the rom-census workflow). All three link the same set.
 * A name here says "an image may jump to this address expecting this
 * function"; it does not say the function is provided (see rom-hle.ts).
 */
export declare const ROM_SYMBOLS: Readonly<Record<string, number>>;
