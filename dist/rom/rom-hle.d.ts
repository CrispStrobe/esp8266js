/**
 * Stand-ins for ESP8266 mask ROM functions, so firmware can run without the
 * ROM image.
 *
 * HOW. The ROM window is left empty. Every known ROM entry point
 * (rom-symbols.ts) gets a hook at its address: when the program counter
 * arrives there, the hook does what the function does, in the host, and
 * returns to the caller. Firmware uses the CALL0 ABI throughout (the LX106
 * has no register windows): arguments in a2..a7, result in a2 (a 64-bit value
 * in a2 = low word, a3 = high word), return address in a0.
 *
 * WHAT IS PROVIDED is exactly the `provided` list of an instance. A known ROM
 * entry with no stand-in is NOT skipped and does NOT return zero: it stops
 * the run through `onMissing`, by name, because firmware that carried on
 * after a ROM call that silently did nothing would fail somewhere else and
 * look like a simulator bug.
 *
 * WHAT IS NOT CLAIMED. The stand-ins are written from the functions'
 * documented C contracts (libc, libgcc), not from the ROM's code, which this
 * project neither ships nor reads. Where the ROM may differ from the
 * contract (division by zero, float-to-integer conversion of NaN and of
 * out-of-range values) the choice made here is stated at the function and has
 * not been compared with hardware.
 */
import { ESP8266 } from '../esp8266';
/** What the stand-ins remember between calls: the ROM's own variables, in the host. */
export interface IRomState {
    /** The character output routine firmware installed (ets_install_putc1), or 0 for the ROM's UART one. */
    putc: number;
    /** The UART the ROM's character output goes to (uart_buff_switch). */
    uart: number;
    /** What firmware last told the ROM the CPU frequency is, in MHz. */
    cpuMhz: number;
    /** Interrupt service routines by interrupt number (ets_isr_attach). */
    isr: Map<number, {
        fn: number;
        arg: number;
    }>;
    /** Exception handlers by cause (_xtos_set_exception_handler). */
    exceptionHandlers: Map<number, number>;
    /** Tasks by priority (ets_task), each with the events posted to it and not yet delivered. */
    tasks: Map<number, {
        fn: number;
        queue: number;
        length: number;
        events: Array<[number, number]>;
    }>;
    /** The routine ets_run calls when no task has an event (ets_set_idle_cb), or 0. */
    idle: {
        fn: number;
        arg: number;
    };
}
/** The registers and memory a stand-in works with. */
export interface IRomCall {
    readonly esp: ESP8266;
    readonly state: IRomState;
    /**
     * Argument `n` as an unsigned 32-bit value: register a2+n for the first
     * six, then the caller's stack (how CALL0 passes further and variadic ones).
     */
    arg(n: number): number;
    /** Arguments `n` (low word) and `n + 1` (high word) as one unsigned 64-bit value. */
    arg64(n: number): bigint;
    /** Arguments `n`, `n + 1` as an IEEE-754 double. */
    argDouble(n: number): number;
    /** Argument `n` as an IEEE-754 single. */
    argFloat(n: number): number;
    read8(addr: number): number;
    write8(addr: number, value: number): void;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
    /** Read or write the interrupt enable mask, so that newly enabled interrupts are noticed. */
    interruptEnable(update?: (mask: number) => number): number;
    /** The NUL-terminated bytes at `addr`, without the NUL. */
    cstring(addr: number): number[];
}
/**
 * A stand-in that has to run firmware code (a callback the firmware handed
 * to the ROM) returns this instead of a value: the function is called with
 * up to six arguments, and `then` receives its result and says how the
 * stand-in goes on, with a value or with another call.
 */
export interface IGuestCall {
    fn: number;
    args?: number[];
    then: (result: number) => RomResult;
}
/** What a stand-in returns: nothing, a 32-bit value, a wider one, or a call into firmware. */
export type RomResult = void | number | {
    u64: bigint;
} | {
    double: number;
} | {
    float: number;
} | {
    callGuest: IGuestCall;
} | {
    wait: () => RomResult;
};
/**
 * Where the core rests while a stand-in waits for an interrupt (ets_run with
 * nothing to do), and where it comes back to afterwards. Not a ROM entry.
 */
export declare const WAIT_RESUME = 1073807348;
/**
 * The radio. `phy_get_romfuncs` hands the SDK's radio library a table of
 * ROM routines it then calls by index. There is no radio here: every slot of
 * the table this simulator hands out points into PHY_STUBS, each call is
 * counted as `(radio ROM routine N)` and answered with 0. Firmware gets past
 * its radio start-up this way; nothing it then believes about the radio is
 * true.
 */
export declare const PHY_STUBS = 1073803264;
export declare const PHY_STUB_COUNT = 256;
/** Where the table itself is kept: in the RAM the ROM uses for its own data. */
export declare const PHY_TABLE = 1073727488;
/**
 * The ROM's exception dispatch table. Firmware that installs its own vectors
 * (the SDK does, at 0x40100000) still ends up in the ROM: its vector code
 * looks the handler up in a table the ROM keeps at the start of its RAM, one
 * word per exception cause, and jumps there. Each slot is seeded to point at
 * XTOS_ENTRIES + 4 * cause, which leads into the dispatcher below.
 *
 * What that vector code has done by the time it jumps was read off the
 * firmware's own code (Arduino core 3.1.2 images), not off the ROM: a0 is in
 * EXCSAVE1, the stack pointer is lowered by 0x100, and a2, a3, a4 are stored
 * at 0x14, 0x18, 0x1c of that frame. An image whose vector code differs
 * would be dispatched wrongly.
 */
export declare const XTOS_TABLE = 1073725440;
export declare const XTOS_ENTRIES = 1073805312;
export declare class UnhandledException extends Error {
    readonly cause_: number;
    readonly pc: number;
    constructor(cause_: number, pc: number, what: string);
}
/**
 * Where firmware code called from a stand-in returns to. An address in the
 * ROM window that is not a ROM entry point; nothing is stored there.
 */
export declare const GUEST_RETURN = 1073807344;
export type RomFunction = (call: IRomCall) => RomResult;
export declare class RomFunctionMissing extends Error {
    readonly romFunction: string;
    readonly address: number;
    readonly caller: number;
    constructor(romFunction: string, address: number, caller: number);
}
/** The stand-ins this build provides, by ROM symbol name. */
export declare const ROM_FUNCTIONS: Readonly<Record<string, RomFunction>>;
/**
 * Installs the stand-ins on an ESP8266 and counts what the firmware calls.
 *
 *   const rom = new RomHle(esp);
 *   rom.install();
 *
 * `calls` is the run's own census: how often each ROM entry was reached,
 * provided or not.
 */
export declare class RomHle {
    private readonly esp;
    private readonly functions;
    private readonly symbols;
    /** Calls per ROM function name, in the order first seen. */
    readonly calls: Map<string, number>;
    /** What to do when firmware code called from the host returns, innermost last. */
    private readonly pending;
    /** The ROM's variables. */
    readonly state: IRomState;
    /** A stand-in waiting for an interrupt: how it goes on, and who called it. */
    private parked;
    /** Called for a known ROM entry with no stand-in. The default throws RomFunctionMissing. */
    onMissing: (name: string, address: number, caller: number) => void;
    constructor(esp: ESP8266, functions?: Readonly<Record<string, RomFunction>>, symbols?: Readonly<Record<string, number>>);
    /** Names of the ROM entries that have a stand-in. */
    get provided(): string[];
    /** Names of the known ROM entries that stop the run if reached. */
    get missing(): string[];
    install(): void;
    private enter;
    /** Firmware code called from a stand-in has returned: carry on with that stand-in. */
    private resume;
    /** Run firmware code at `fn`; `go` runs when it returns. */
    private callInto;
    /** An interrupt has been served while a stand-in waited: let it look again. */
    private wake;
    /**
     * The exception vectors are ROM code, so taking an exception or a level-1
     * interrupt lands here. This does what the ROM's dispatcher is for: save
     * the interrupted registers, call what the firmware registered, restore,
     * and return to the interrupted instruction.
     *
     * Interrupts: every pending enabled one is served, highest number first,
     * with level-1 interrupts masked meanwhile. The order is an assumption
     * (the usual XTOS default), not something read from the ROM.
     *
     * Other exceptions: the registered handler gets a pointer to a frame on
     * the stack { epc, ps, sar, unused, a0, a2..a15, cause } and the cause, may
     * change the frame, and execution resumes from what the frame then says.
     */
    private exception;
    /** Apply what a stand-in returned, and go back to `caller` or on into firmware. */
    private finish;
    private callFor;
}
