import type { IRomCall, RomFunction } from './rom-hle';
/**
 * printf for the ROM's console. Supports what the SDK and Arduino boot
 * messages use: %c %s %d %i %u %x %X %p %%, a field width, a `0` or `-`
 * flag, and the `l` / `h` length letters (all integers are 32 bits here).
 * Anything else is printed as written, so an unsupported conversion is
 * visible in the output rather than dropped.
 */
export declare function formatRom(c: IRomCall, format: number[], next: () => number): number[];
export declare const SYSTEM_FUNCTIONS: Readonly<Record<string, RomFunction>>;
