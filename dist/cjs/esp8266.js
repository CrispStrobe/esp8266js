"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266 = void 0;
const simulation_clock_1 = require("./clock/simulation-clock");
const clocks_1 = require("./core/clocks");
const gdb_registers_1 = require("./core/gdb-registers");
const int_1 = require("./core/int");
const lx106_core_1 = require("./core/lx106-core");
const memory_1 = require("./core/memory");
const xtensa_regs_1 = require("./core/xtensa-regs");
const base_peripheral_1 = require("./peripherals/base-peripheral");
const bwnet_1 = require("./peripherals/bwnet");
const dport_1 = require("./peripherals/dport");
const frc_1 = require("./peripherals/frc");
const gpio_1 = require("./peripherals/gpio");
const hdrf_1 = require("./peripherals/hdrf");
const iomux_1 = require("./peripherals/iomux");
const rtc_1 = require("./peripherals/rtc");
const sar_1 = require("./peripherals/sar");
const spi_1 = require("./peripherals/spi");
const uart_1 = require("./peripherals/uart");
const wdev_1 = require("./peripherals/wdev");
const MB = 1024 * 1024;
const DPORT_START = 0x3ff00000;
const DPORT_END = DPORT_START + 0x10000;
const WDEV_START = 0x3ff20000;
const WDEV_END = 0x3ff22000;
const ROM1_START = 0x3ff90000;
const DATA_START = 0x3ffe8000;
const IRAM_START = 0x40100000;
const IRAM_END = 0x40140000;
const INSTRUCTIONS_START = 0x40000000;
const CHIP_ROM_SIZE = 0x10000;
const RTC_SLOW_START = 0x60001200;
const AHB_START = 0x60000000;
const AHB_END = 0x60040000;
class ESP8266 {
    constructor(config = {}) {
        this.config = config;
        this.flash = new Uint8Array((this.config.flashSizeMB ?? 4) * MB);
        this.flashMemory = new memory_1.ReadonlyMemory(this.flash, 0x40200000);
        this.chipROM = new memory_1.ReadonlyMemory(new Uint8Array(CHIP_ROM_SIZE), INSTRUCTIONS_START);
        this.rom1 = this.chipROM.createView(ROM1_START, 0x60000, 0x10000);
        this.iram = new memory_1.Memory(new Uint8Array(IRAM_END - IRAM_START), IRAM_START);
        this.dataMem = new memory_1.Memory(new Uint8Array(INSTRUCTIONS_START - DATA_START), DATA_START);
        this.rtcSlowMem = new memory_1.Memory(new Uint8Array(8 * 1024), RTC_SLOW_START);
        this.invalidMem = new memory_1.InvalidMemory();
        this.dmaBase = 0x3ff00000;
        this.peripheralMap = {};
        this.resetReason = 1;
        this.onReset = () => true;
        this.onAnalogRead = () => 0;
        this.cores = [new lx106_core_1.LX106Core(this, 'MAIN', gdb_registers_1.esp8266GDBRegisters)];
        // Clocks
        this.clock = this.config.clock ?? new simulation_clock_1.SimulationClock(80000000, this);
        this.clocks = new clocks_1.ESP8266Clocks(this.clock);
        this.cycles = 0;
        this.stopped = true;
        this.writeWatchPoints = new Set();
        this.lastMappedAddress = 0;
        this.flash.fill(0xff);
        const spiConfig = {
            flash: false,
            irq: int_1.ESP8266Interrupts.ETS_SPI,
        };
        this.uart = [
            new uart_1.ESP8266UART(this, 0x60000000, 'UART0', 0, int_1.ESP8266Interrupts.ETS_UART),
            new uart_1.ESP8266UART(this, 0x60000f00, 'UART1', 1, -1),
        ];
        this.spi = [
            new spi_1.ESP8266SPI(this, 0x60000100, 'SPI1', spiConfig),
            new spi_1.ESP8266SPI(this, 0x60000200, 'SPI0', { ...spiConfig, flash: true }),
        ];
        this.gpio = new gpio_1.ESP8266GPIO(this, 0x60000300, 'GPIO', int_1.ESP8266Interrupts.ETS_GPIO);
        this.net = new bwnet_1.BWNet(this, 0x60000c00, 'BWNET', this.config.net?.world, this.config.net?.mac);
        this.peripherals = [
            this.gpio,
            ...this.uart,
            ...this.spi,
            new dport_1.ESP8266DPort(this, DPORT_START, 'DPort Register'),
            new wdev_1.ESP8266WDev(this, WDEV_START, 'WDEV'),
            new hdrf_1.ESP8266HDRF(this, 0x60000500, 'HDRF'),
            new frc_1.ESPFRC(this, 0x60000600, 'FRC', int_1.ESP8266Interrupts.ETS_FRC_TIMER2, int_1.ESP8266Interrupts.ETS_FRC_TIMER1),
            new rtc_1.ESP8266RTC(this, 0x60000700, 'RTC'),
            new iomux_1.ESP8266IOMUX(this, 0x60000800, 'IO MUX', this.gpio),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60000900, 'WDT'),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60000a00, 'SDIO'),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60000b00, 'SLC0'),
            this.net,
            new sar_1.ESP8266SAR(this, 0x60000d00, 'SAR'),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60000e00, 'I2S0'),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60001000, 'rtc_data'),
            new base_peripheral_1.UnimplementedPeripheral(this, 0x60001100, 'rtc_sys_info'),
        ];
        for (const peripheral of this.peripherals) {
            this.peripheralMap[peripheral.baseAddr] = peripheral;
        }
        this.reset();
    }
    loadROM(binary) {
        this.chipROM.set(binary, INSTRUCTIONS_START);
    }
    reset() {
        for (const core of this.cores) {
            core.reset();
        }
        for (const peripheral of this.peripherals) {
            peripheral.reset();
        }
    }
    mapAddress(addr) {
        this.lastMappedAddress = addr;
        if (addr >= DPORT_START && addr < DPORT_END) {
            return this.peripherals.find((p) => p.baseAddr === DPORT_START);
        }
        if (addr >= WDEV_START && addr < WDEV_END) {
            return this.peripherals.find((p) => p.baseAddr === WDEV_START);
        }
        if (addr >= AHB_START && addr <= AHB_END) {
            const peripheral = this.peripheralMap[addr & 0xffffff00];
            if (peripheral) {
                return peripheral;
            }
        }
        if (addr >= DATA_START && addr < INSTRUCTIONS_START) {
            return this.dataMem;
        }
        if (addr >= ROM1_START && addr < DATA_START) {
            return this.rom1;
        }
        if (addr >= INSTRUCTIONS_START && addr < INSTRUCTIONS_START + CHIP_ROM_SIZE) {
            return this.chipROM;
        }
        if (addr >= IRAM_START && addr < IRAM_END) {
            return this.iram;
        }
        if (this.flashMemory.contains(addr)) {
            return this.flashMemory;
        }
        return this.invalidMem;
    }
    step() {
        this.cores[0].runInstruction();
        this.cycles++;
        if (this.clock instanceof simulation_clock_1.SimulationClock) {
            this.clock.tick();
        }
    }
    get coresIdle() {
        const { cores } = this;
        return cores[0].idle && !cores[0].pendingInterrupts;
    }
    get refNanos() {
        return this.clock.nanos;
    }
    interrupt(index, set = true) {
        if (index < 0) {
            return;
        }
        const core = this.cores[0];
        if (set) {
            core.specialRegisters[xtensa_regs_1.INTSET] |= 1 << index;
        }
        else {
            core.specialRegisters[xtensa_regs_1.INTSET] &= ~(1 << index);
        }
        core.pendingInterrupts = !!core.specialRegisters[xtensa_regs_1.INTSET];
    }
    get apbNanos() {
        return 1e9 / this.clocks.apbFreq;
    }
    get devices() {
        return {
            nonvolatile: { flash: this.flash },
            volatile: {
                iram: this.iram.data,
                dram: this.dataMem.data,
                rtc: this.rtcSlowMem.data,
            },
        };
    }
}
exports.ESP8266 = ESP8266;
//# sourceMappingURL=esp8266.js.map