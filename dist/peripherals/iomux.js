import { BasePeripheral } from './base-peripheral';
const FUN_OE = 1 << 0;
const FUN_WPD = 1 << 6;
const FUN_WPU = 1 << 7;
var PinFunction;
(function (PinFunction) {
    PinFunction[PinFunction["GPIO"] = 0] = "GPIO";
    PinFunction[PinFunction["MTDI"] = 1] = "MTDI";
    PinFunction[PinFunction["MTCK"] = 2] = "MTCK";
    PinFunction[PinFunction["MTMS"] = 3] = "MTMS";
    PinFunction[PinFunction["MTDO"] = 4] = "MTDO";
    PinFunction[PinFunction["U0RXD"] = 5] = "U0RXD";
    PinFunction[PinFunction["U0TXD"] = 6] = "U0TXD";
    PinFunction[PinFunction["SD_CLK"] = 7] = "SD_CLK";
    PinFunction[PinFunction["SD_DATA0"] = 8] = "SD_DATA0";
    PinFunction[PinFunction["SD_DATA1"] = 9] = "SD_DATA1";
    PinFunction[PinFunction["SD_DATA2"] = 10] = "SD_DATA2";
    PinFunction[PinFunction["SD_DATA3"] = 11] = "SD_DATA3";
    PinFunction[PinFunction["SD_CMD"] = 12] = "SD_CMD";
    PinFunction[PinFunction["I2SI_DATA"] = 13] = "I2SI_DATA";
    PinFunction[PinFunction["I2SI_BCK"] = 14] = "I2SI_BCK";
    PinFunction[PinFunction["I2SI_WS"] = 15] = "I2SI_WS";
    PinFunction[PinFunction["I2SO_BCK"] = 16] = "I2SO_BCK";
    PinFunction[PinFunction["I2SO_DATA"] = 17] = "I2SO_DATA";
    PinFunction[PinFunction["SPICS1"] = 18] = "SPICS1";
    PinFunction[PinFunction["SPI_CLK"] = 19] = "SPI_CLK";
    PinFunction[PinFunction["SPIQ"] = 20] = "SPIQ";
    PinFunction[PinFunction["SPID"] = 21] = "SPID";
    PinFunction[PinFunction["SPIHD"] = 22] = "SPIHD";
    PinFunction[PinFunction["SPIWP"] = 23] = "SPIWP";
    PinFunction[PinFunction["SPICS0"] = 24] = "SPICS0";
    PinFunction[PinFunction["HSPIQ"] = 25] = "HSPIQ";
    PinFunction[PinFunction["HSPID"] = 26] = "HSPID";
    PinFunction[PinFunction["HSPICLK"] = 27] = "HSPICLK";
    PinFunction[PinFunction["HSPICS"] = 28] = "HSPICS";
    PinFunction[PinFunction["SPICS2"] = 29] = "SPICS2";
    PinFunction[PinFunction["I2SOWS"] = 30] = "I2SOWS";
    PinFunction[PinFunction["U0DTR"] = 31] = "U0DTR";
    PinFunction[PinFunction["U0CTS"] = 32] = "U0CTS";
    PinFunction[PinFunction["U0DSR"] = 33] = "U0DSR";
    PinFunction[PinFunction["U0RTS"] = 34] = "U0RTS";
    PinFunction[PinFunction["CLK_XTAL"] = 35] = "CLK_XTAL";
    PinFunction[PinFunction["CLK_RTC"] = 36] = "CLK_RTC";
    PinFunction[PinFunction["U1CTS"] = 37] = "U1CTS";
    PinFunction[PinFunction["U1TXD"] = 38] = "U1TXD";
    PinFunction[PinFunction["U1RXD"] = 39] = "U1RXD";
    PinFunction[PinFunction["HSPIHD"] = 40] = "HSPIHD";
    PinFunction[PinFunction["HSPIWP"] = 41] = "HSPIWP";
    PinFunction[PinFunction["U1RTS"] = 42] = "U1RTS";
    PinFunction[PinFunction["CLK_OUT"] = 43] = "CLK_OUT";
})(PinFunction || (PinFunction = {}));
const FN = PinFunction;
const pins = [
    null,
    { index: 12, fn: [FN.MTDI, FN.I2SI_DATA, FN.HSPIQ, FN.GPIO, FN.U0DTR] },
    { index: 13, fn: [FN.MTCK, FN.I2SI_BCK, FN.HSPID, FN.GPIO, FN.U0CTS] },
    { index: 14, fn: [FN.MTMS, FN.I2SI_WS, FN.HSPICLK, FN.GPIO, FN.U0DSR] },
    { index: 15, fn: [FN.MTDO, FN.I2SO_BCK, FN.HSPICS, FN.GPIO, FN.U0RTS] },
    { index: 3, fn: [FN.U0RXD, FN.I2SO_DATA, null, FN.GPIO, FN.CLK_XTAL] },
    { index: 1, fn: [FN.U0TXD, FN.SPICS1, null, FN.GPIO, FN.CLK_RTC] },
    { index: 6, fn: [FN.SD_CLK, FN.SPI_CLK, null, FN.GPIO, FN.U1CTS] },
    { index: 7, fn: [FN.SD_DATA0, FN.SPIQ, null, FN.GPIO, FN.U1TXD] },
    { index: 8, fn: [FN.SD_DATA1, FN.SPID, null, FN.GPIO, FN.U1RXD] },
    { index: 9, fn: [FN.SD_DATA2, FN.SPIHD, null, FN.GPIO, FN.HSPIHD] },
    { index: 10, fn: [FN.SD_DATA3, FN.SPIWP, null, FN.GPIO, FN.HSPIWP] },
    { index: 11, fn: [FN.SD_CMD, FN.SPICS0, null, FN.GPIO, FN.U1RTS] },
    { index: 0, fn: [FN.GPIO, FN.SPICS2, null, null, FN.CLK_OUT] },
    { index: 2, fn: [FN.GPIO, FN.I2SOWS, FN.U1TXD, null, FN.U0TXD] },
    { index: 4, fn: [FN.GPIO, FN.CLK_XTAL, null, null] },
    { index: 5, fn: [FN.GPIO, FN.CLK_RTC, null, null] },
];
export class ESP8266IOMUX extends BasePeripheral {
    constructor(esp, baseAddr, name, gpio) {
        super(esp, baseAddr, name);
        this.gpio = gpio;
    }
    writeUint32(addr, value) {
        const offset = addr - this.baseAddr;
        const pinInfo = pins[offset >> 2];
        if (pinInfo) {
            const { index } = pinInfo;
            this.gpio.pins[index].gpioOutputEnable = !!(value & FUN_OE);
            this.gpio.pins[index].internalPullDown = !!(value & FUN_WPD);
            this.gpio.pins[index].internalPullUp = !!(value & FUN_WPU);
            this.gpio.updateGPIO();
        }
        super.writeUint32(addr, value);
    }
    reset() {
        super.reset();
        this.writeUint32(this.baseAddr + 4, 0x00000080);
        this.writeUint32(this.baseAddr + 8, 0x00000080);
        this.writeUint32(this.baseAddr + 12, 0x00000080);
        this.writeUint32(this.baseAddr + 16, 0x00000080);
        this.writeUint32(this.baseAddr + 20, 0x00000080);
        this.writeUint32(this.baseAddr + 24, 0x00000000);
        this.writeUint32(this.baseAddr + 28, 0x00000010);
        this.writeUint32(this.baseAddr + 32, 0x00000010);
        this.writeUint32(this.baseAddr + 36, 0x00000010);
        this.writeUint32(this.baseAddr + 40, 0x00000010);
        this.writeUint32(this.baseAddr + 44, 0x00000010);
        this.writeUint32(this.baseAddr + 48, 0x00000010);
        this.writeUint32(this.baseAddr + 52, 0x00000080);
        this.writeUint32(this.baseAddr + 56, 0x000000a0);
        this.writeUint32(this.baseAddr + 60, 0x00000000);
        this.writeUint32(this.baseAddr + 64, 0x00000000);
    }
}
//# sourceMappingURL=iomux.js.map