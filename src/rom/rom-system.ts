/**
 * ROM stand-ins that touch the machine: SPI flash, the console, the clock
 * and the pins.
 *
 * Contracts are the ones Espressif's SDK headers declare for these ROM
 * routines (spi_flash.h, ets_sys.h, gpio.h, uart.h) and the register
 * addresses those headers name. Nothing here was read from the ROM.
 */
import { SimulationClock } from '../clock/simulation-clock';
import type { IRomCall, RomFunction, RomResult } from './rom-hle';

const SPI_FLASH_OK = 0;
const SPI_FLASH_ERROR = 1;
const SECTOR = 4096;

const GPIO_OUT_W1TS = 0x60000304;
const GPIO_OUT_W1TC = 0x60000308;
const GPIO_ENABLE_W1TS = 0x60000310;
const GPIO_ENABLE_W1TC = 0x60000314;
const GPIO_IN = 0x60000318;
const UART_BASE = [0x60000000, 0x60000f00];
const UART_FIFO = 0x0;
const UART_CLKDIV = 0x14;

function inFlash(c: IRomCall, addr: number, size: number) {
  return addr + size <= c.esp.flash.length;
}

/** One character to the ROM's console UART, as a FIFO write (so the UART model sees it). */
function putChar(c: IRomCall, ch: number) {
  c.write32(UART_BASE[c.state.uart] + UART_FIFO, ch & 0xff);
}

/**
 * printf for the ROM's console. Supports what the SDK and Arduino boot
 * messages use: %c %s %d %i %u %x %X %p %%, a field width, a `0` or `-`
 * flag, and the `l` / `h` length letters (all integers are 32 bits here).
 * Anything else is printed as written, so an unsupported conversion is
 * visible in the output rather than dropped.
 */
export function formatRom(c: IRomCall, format: number[], next: () => number) {
  const out: number[] = [];
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  };
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== 0x25) {
      out.push(format[i]);
      continue;
    }
    const start = i;
    i++;
    let left = false;
    let zero = false;
    for (; format[i] === 0x2d || format[i] === 0x30; i++) {
      if (format[i] === 0x2d) left = true;
      else zero = true;
    }
    let width = 0;
    for (; format[i] >= 0x30 && format[i] <= 0x39; i++) width = width * 10 + (format[i] - 0x30);
    while (format[i] === 0x6c || format[i] === 0x68) i++;
    const conv = i < format.length ? String.fromCharCode(format[i]) : '';
    let text: string | null = null;
    if (conv === '%') text = '%';
    else if (conv === 'c') text = String.fromCharCode(next() & 0xff);
    else if (conv === 's') {
      const at = next();
      text = at ? String.fromCharCode(...c.cstring(at)) : '(null)';
    } else if (conv === 'd' || conv === 'i') text = String(next() | 0);
    else if (conv === 'u') text = String(next() >>> 0);
    else if (conv === 'x' || conv === 'p') text = (next() >>> 0).toString(16);
    else if (conv === 'X') text = (next() >>> 0).toString(16).toUpperCase();
    if (text == null) {
      out.push(...format.slice(start, i + 1));
      continue;
    }
    if (conv !== '%' && text.length < width) {
      const pad = width - text.length;
      if (left) text = text + ' '.repeat(pad);
      else if (zero && conv !== 's' && conv !== 'c') {
        const negative = text[0] === '-';
        text = (negative ? '-' : '') + '0'.repeat(pad) + (negative ? text.slice(1) : text);
      } else text = ' '.repeat(pad) + text;
    }
    push(text);
  }
  return out;
}

const inRom = (addr: number) => addr >= 0x40000000 && addr <= 0x4000ffff;

/**
 * Send `bytes` through a character output routine and return their count:
 * the ROM's own console when `routine` is 0 or a ROM address, otherwise the
 * firmware's routine, called once per character.
 */
function writeThrough(c: IRomCall, routine: number, bytes: number[]): RomResult {
  if (routine === 0 || inRom(routine)) {
    for (const b of bytes) putChar(c, b);
    return bytes.length;
  }
  const from = (i: number): RomResult =>
    i === bytes.length
      ? bytes.length
      : { callGuest: { fn: routine, args: [bytes[i]], then: () => from(i + 1) } };
  return from(0);
}

/**
 * The next 32-bit variadic argument of a `va_list` held in three words
 * (stack pointer, register save area, index): GCC's Xtensa layout, in which
 * the first 24 bytes come from the register save area and the rest from the
 * stack area starting at offset 32.
 */
function vaList(c: IRomCall, stk: number, reg: number, start: number) {
  let ndx = start;
  return () => {
    if (ndx + 4 <= 24) {
      const value = c.read32(reg + ndx);
      ndx += 4;
      return value;
    }
    if (ndx < 32) ndx = 32;
    const value = c.read32(stk + ndx);
    ndx += 4;
    return value;
  };
}

export const SYSTEM_FUNCTIONS: Readonly<Record<string, RomFunction>> = {
  // ── SPI flash: the flash array itself, no SPI traffic ──
  SPIRead: (c) => {
    const [addr, dest, size] = [c.arg(0), c.arg(1), c.arg(2)];
    if (!inFlash(c, addr, size)) return SPI_FLASH_ERROR;
    for (let i = 0; i < size; i++) c.write8(dest + i, c.esp.flash[addr + i]);
    return SPI_FLASH_OK;
  },
  SPIWrite: (c) => {
    const [addr, src, size] = [c.arg(0), c.arg(1), c.arg(2)];
    if (!inFlash(c, addr, size)) return SPI_FLASH_ERROR;
    // NOR flash: programming can only clear bits.
    for (let i = 0; i < size; i++) c.esp.flash[addr + i] &= c.read8(src + i);
    return SPI_FLASH_OK;
  },
  SPIEraseSector: (c) => {
    const start = c.arg(0) * SECTOR;
    if (!inFlash(c, start, SECTOR)) return SPI_FLASH_ERROR;
    c.esp.flash.fill(0xff, start, start + SECTOR);
    return SPI_FLASH_OK;
  },
  // The flash is never busy and never write-protected here.
  Wait_SPI_Idle: () => SPI_FLASH_OK,
  SPI_write_enable: () => SPI_FLASH_OK,
  SPI_write_status: () => SPI_FLASH_OK,
  SPI_read_status: (c) => {
    c.write32(c.arg(1), 0);
    return SPI_FLASH_OK;
  },
  Enable_QMode: () => SPI_FLASH_OK,
  // Flash is mapped at 0x40200000 from offset 0, always; only that mapping is accepted.
  Cache_Read_Enable: (c) => {
    if (c.arg(0) !== 0 || c.arg(1) !== 0) {
      throw new Error(
        `Cache_Read_Enable(${c.arg(0)}, ${c.arg(1)}, ${c.arg(2)}): only the mapping of the first ` +
          'megabyte pair from flash offset 0 is modelled'
      );
    }
  },
  Cache_Read_Disable: () => undefined,

  // ── console ──
  ets_install_putc1: (c) => {
    // A routine inside the ROM window is the ROM's own console output.
    const routine = c.arg(0);
    c.state.putc = routine >= 0x40000000 && routine <= 0x4000ffff ? 0 : routine;
  },
  ets_install_uart_printf: (c) => {
    c.state.putc = 0;
  },
  uart_buff_switch: (c) => {
    c.state.uart = c.arg(0) & 1;
  },
  ets_putc: (c) => {
    putChar(c, c.arg(0));
  },
  ets_write_char: (c) => {
    putChar(c, c.arg(0));
  },
  ets_uart_putc1: (c) => {
    putChar(c, c.arg(0));
  },
  ets_printf: (c) => {
    let n = 1;
    return writeThrough(c, c.state.putc, formatRom(c, c.cstring(c.arg(0)), () => c.arg(n++)));
  },
  // ets_vprintf(output routine, format, va_list): the va_list is passed by value in a4..a6.
  ets_vprintf: (c) =>
    writeThrough(
      c,
      c.arg(0),
      formatRom(c, c.cstring(c.arg(1)), vaList(c, c.arg(2), c.arg(3), c.arg(4)))
    ),
  rom_uart_div_modify: (c) => {
    c.write32(UART_BASE[c.arg(0) & 1] + UART_CLKDIV, c.arg(1));
  },

  // ── clock ──
  ets_delay_us: (c) => {
    // Simulated time passes; timers due in the interval fire, and interrupts
    // they raise are taken once this returns (on the chip they would preempt).
    // Counted in CPU cycles: converting to nanoseconds and back can round to
    // just short of the deadline and never arrive.
    const { esp } = c;
    const { clock } = esp;
    const frequency = clock instanceof SimulationClock ? clock.frequency : 80e6;
    const target = esp.cycles + Math.ceil((c.arg(0) * frequency) / 1e6);
    const deadline = (target / frequency) * 1e9;
    let stalled = 0;
    while (esp.cycles < target) {
      const before = esp.cycles;
      clock.skipToNextEvent(deadline);
      // An event due now runs without moving time; a run of those must not hang the delay.
      if (esp.cycles > before) stalled = 0;
      else if (++stalled > 1000) esp.cycles = target;
    }
  },
  ets_get_cpu_frequency: (c) => c.state.cpuMhz,
  ets_update_cpu_frequency: (c) => {
    c.state.cpuMhz = c.arg(0);
  },
  rtc_get_reset_reason: (c) => c.esp.resetReason,

  // ── pins ──
  gpio_input_get: (c) => c.read32(GPIO_IN),
  gpio_output_set: (c) => {
    // (set, clear, enable, disable) masks, each through its write-one register.
    c.write32(GPIO_OUT_W1TS, c.arg(0));
    c.write32(GPIO_OUT_W1TC, c.arg(1));
    c.write32(GPIO_ENABLE_W1TS, c.arg(2));
    c.write32(GPIO_ENABLE_W1TC, c.arg(3));
  },

  // ── radio: a table of routines that all answer 0 (see PHY_STUBS in rom-hle.ts) ──
  phy_get_romfuncs: () => 0x3fffc800,
  // Clear-channel assessment on and off: nothing to switch without a radio.
  rom_chip_v5_disable_cca: () => undefined,
  rom_chip_v5_enable_cca: () => undefined,

  // Buffer descriptor chains for the radio's DMA. Each descriptor is three
  // words: { size:12, length:12, unused:5, sub_sof:1, eof:1, owner:1 },
  // buffer pointer, next pointer (the SDK's struct sdio_queue layout). The
  // chain covers `buffer length` bytes in blocks of `block size`; `length`
  // is left 0 and no end mark is set. Those two choices are assumptions:
  // nothing here consumes the descriptors, the firmware only keeps the head
  // and tail it gets back.
  lldesc_build_chain: (c) => {
    const [desc, descBytes, buffer, bufferBytes, block, owner, head, tail] = [
      c.arg(0), c.arg(1), c.arg(2), c.arg(3), c.arg(4), c.arg(5) & 1, c.arg(6), c.arg(7),
    ];
    const count = Math.min(Math.floor(descBytes / 12), block ? Math.ceil(bufferBytes / block) : 0);
    for (let i = 0; i < count; i++) {
      const at = desc + i * 12;
      const size = Math.min(block, bufferBytes - i * block) & 0xfff;
      c.write32(at, (size | (owner << 31)) >>> 0);
      c.write32(at + 4, buffer + i * block);
      c.write32(at + 8, i + 1 < count ? at + 12 : 0);
    }
    c.write32(head, count ? desc : 0);
    c.write32(tail, count ? desc + (count - 1) * 12 : 0);
  },
  // The descriptor `n - 1` links after `head` (assumed meaning: the last of a run of n).
  lldesc_num2link: (c) => {
    let at = c.arg(0);
    for (let i = 1; i < (c.arg(1) & 0xffff) && at; i++) at = c.read32(at + 8);
    return at;
  },

  // ── small helpers ──
  roundup2: (c) => ((c.arg(0) + c.arg(1) - 1) & ~(c.arg(1) - 1)) >>> 0,
};
