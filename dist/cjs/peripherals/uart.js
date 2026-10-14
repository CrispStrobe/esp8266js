"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266UART = exports.UARTTxState = void 0;
const base_peripheral_1 = require("./base-peripheral");
const FIFO_SIZE = 128;
const UART_FIFO_REG = 0;
const UART_INT_RAW_REG = 0x4;
const UART_INT_ST_REG = 0x8;
const UART_INT_ENA_REG = 0xc;
const UART_INT_CLEAR_REG = 0x10;
const UART_CLKDIV_REG = 0x14;
const UART_AUTOBAUD_REG = 0x18;
const UART_STATUS_REG = 0x1c;
const UART_CONF0_REG = 0x20;
const UART_CONF1_REG = 0x24;
const UART_LOWPULSE_REG = 0x28;
const UART_HIGHPULSE_REG = 0x2c;
const UART_RXD_CNT_REG = 0x30;
const UART_MEM_RX_STATUS_REG = 0x60;
const UART_DATE_REG = 0x78;
const UART_ID_REG = 0x7c;
// UART_CONF0_REG bits
const UART_BIT_NUM_SHIFT = 2;
const UART_BIT_NUM_MASK = 0x3;
const UART_STOP_BIT_NUM_SHIFT = 4;
const UART_STOP_BIT_NUM_MASK = 0x3;
const UART_TICK_REF_ALWAYS_ON = 1 << 27;
// UART_AUTOBAUD_REG bits
const UART_AUTOBAUD_EN = 1 << 0;
// UART_STATUS_REG bits
const UART_RXFIFO_CNT_MASK = 0xff;
const UART_RXFIFO_CNT_SHIFT = 0;
const UART_TXFIFO_CNT_MASK = 0xff;
const UART_TXFIFO_CNT_SHIFT = 16;
const UART_ST_UTX_OUT_MASK = 0xf;
const UART_ST_UTX_OUT_SHIFT = 24;
// UART_CLK_CONF_REG bits
const UART_SCLK_SEL_SHIFT = 20;
const UART_SCLK_SEL_MASK = 0x3;
const UART_TX_DONE_INT = 1 << 14;
const UART_RXFIFO_TOUT_INT = 1 << 8;
const UART_TXFIFO_EMPTY_INT = 1 << 1;
const UART_RXFIFO_FULL_INT = 1 << 0;
var UARTTxState;
(function (UARTTxState) {
    UARTTxState[UARTTxState["TX_IDLE"] = 0] = "TX_IDLE";
    UARTTxState[UARTTxState["TX_STRT"] = 1] = "TX_STRT";
    UARTTxState[UARTTxState["TX_DAT0"] = 2] = "TX_DAT0";
    UARTTxState[UARTTxState["TX_DAT1"] = 3] = "TX_DAT1";
    UARTTxState[UARTTxState["TX_DAT2"] = 4] = "TX_DAT2";
    UARTTxState[UARTTxState["TX_DAT3"] = 5] = "TX_DAT3";
    UARTTxState[UARTTxState["TX_DAT4"] = 6] = "TX_DAT4";
    UARTTxState[UARTTxState["TX_DAT5"] = 7] = "TX_DAT5";
    UARTTxState[UARTTxState["TX_DAT6"] = 8] = "TX_DAT6";
    UARTTxState[UARTTxState["TX_DAT7"] = 9] = "TX_DAT7";
    UARTTxState[UARTTxState["TX_PRTY"] = 10] = "TX_PRTY";
    UARTTxState[UARTTxState["TX_STP1"] = 11] = "TX_STP1";
    UARTTxState[UARTTxState["TX_STP2"] = 12] = "TX_STP2";
    UARTTxState[UARTTxState["TX_DL0"] = 13] = "TX_DL0";
    UARTTxState[UARTTxState["TX_DL1"] = 14] = "TX_DL1";
})(UARTTxState = exports.UARTTxState || (exports.UARTTxState = {}));
class ESP8266UART extends base_peripheral_1.BasePeripheral {
    constructor(esp, baseAddr, name, index, irq) {
        super(esp, baseAddr, name);
        this.index = index;
        this.irq = irq;
        this.rxFIFO = [];
        this.txFIFO = [];
        this.rxFullThreshold = 0;
        this.txEmptyThreshold = 0;
        this.txState = UARTTxState.TX_IDLE;
        this.baudRate = 0;
        this.dataReceived = false;
        this.onTX = () => { };
        this.onConfigurationUpdated = () => { };
    }
    get intStatus() {
        return this.readRegister(UART_INT_RAW_REG) & this.readRegister(UART_INT_ENA_REG);
    }
    checkInterrupt() {
        const { rxFullThreshold, txEmptyThreshold } = this;
        let intRaw = this.readRegister(UART_INT_RAW_REG) &
            ~(UART_RXFIFO_FULL_INT | UART_TXFIFO_EMPTY_INT | UART_RXFIFO_TOUT_INT);
        if (this.rxFIFO.length >= rxFullThreshold) {
            intRaw |= UART_RXFIFO_FULL_INT;
        }
        if (this.txFIFO.length < txEmptyThreshold) {
            intRaw |= UART_TXFIFO_EMPTY_INT;
        }
        if (this.rxFIFO.length) {
            intRaw |= UART_RXFIFO_TOUT_INT;
        }
        this.writeRegister(UART_INT_RAW_REG, intRaw);
        this.esp.interrupt(this.irq, this.intStatus !== 0);
    }
    getClock() {
        return this.readRegister(UART_CONF0_REG) & UART_TICK_REF_ALWAYS_ON
            ? this.esp.clocks.apbFreq
            : this.esp.clocks.refFreq;
    }
    updateBaudRate() {
        const clockSource = this.getClock();
        const clkDivValue = this.readRegister(UART_CLKDIV_REG);
        const clkDiv = clkDivValue & 0xfffff;
        const clkFrag = (clkDivValue >> 20) & 0xf;
        this.baudRate = Math.floor(clockSource / (clkDiv + clkFrag / 16));
        this.onConfigurationUpdated(this);
    }
    get txBusy() {
        return this.txState != UARTTxState.TX_IDLE;
    }
    txUpdated() {
        if (!this.txBusy && this.txFIFO.length) {
            const nextValue = this.txFIFO.shift();
            this.clearRegisterBits(UART_INT_RAW_REG, UART_TX_DONE_INT);
            this.txState = UARTTxState.TX_STRT;
            this.onTX(nextValue);
        }
        else if (!this.txFIFO.length) {
            this.setRegisterBits(UART_INT_RAW_REG, UART_TX_DONE_INT);
        }
        this.checkInterrupt();
    }
    txComplete() {
        this.txState = UARTTxState.TX_IDLE;
        this.txUpdated();
    }
    feedByte(value) {
        if (this.rxFIFO.length === FIFO_SIZE) {
            return false;
        }
        this.rxFIFO.push(value);
        this.dataReceived = true;
        this.checkInterrupt();
        return true;
    }
    get bitNum() {
        switch ((this.readRegister(UART_CONF0_REG) >> UART_BIT_NUM_SHIFT) & UART_BIT_NUM_MASK) {
            case 0:
                return 5;
            case 1:
                return 6;
            case 2:
                return 7;
            case 3:
            default:
                return 8;
        }
    }
    readUint8(addr) {
        return this.readUint32(addr) & 0xff;
    }
    readUint16(addr) {
        return this.readUint32(addr) & 0xffff;
    }
    readUint32(addr) {
        switch (addr - this.baseAddr) {
            case UART_FIFO_REG:
                const result = this.rxFIFO.shift();
                if (result == null) {
                    return 0xee;
                }
                else {
                    this.checkInterrupt();
                    return result;
                }
            case UART_INT_ST_REG:
                return this.intStatus;
            case UART_LOWPULSE_REG:
                return 0x2a5; // empirically determined for 115200 baud
            case UART_HIGHPULSE_REG:
                return 0x2a6; // empirically determined for 115200 baud
            case UART_RXD_CNT_REG:
                if (this.dataReceived) {
                    return 0xff; // UART RX edge count - has to be high enough to make the ROM happy
                }
                break;
            case UART_STATUS_REG: {
                let result = ((this.txFIFO.length & UART_TXFIFO_CNT_MASK) << UART_TXFIFO_CNT_SHIFT) |
                    ((this.rxFIFO.length & UART_RXFIFO_CNT_MASK) << UART_RXFIFO_CNT_SHIFT);
                result |= (this.txState & UART_ST_UTX_OUT_MASK) << UART_ST_UTX_OUT_SHIFT;
                return result;
            }
            case UART_MEM_RX_STATUS_REG: {
                const rxLen = this.rxFIFO.length;
                return rxLen < FIFO_SIZE ? rxLen << 13 : 0;
            }
            case UART_DATE_REG:
                return 0x62000;
            case UART_ID_REG:
                return 0x500;
        }
        return super.readUint32(addr);
    }
    writeUint8(addr, value) {
        switch (addr - this.baseAddr) {
            case UART_FIFO_REG:
                if (this.txFIFO.length < FIFO_SIZE) {
                    this.txFIFO.push(value);
                    this.txUpdated();
                }
                return;
        }
        super.writeUint8(addr, value);
    }
    writeUint32(addr, value) {
        switch (addr - this.baseAddr) {
            case UART_FIFO_REG:
                if (this.txFIFO.length < FIFO_SIZE) {
                    this.txFIFO.push(value & 0xff);
                    this.txUpdated();
                }
                return;
            case UART_INT_ENA_REG:
                super.writeRegister(UART_INT_ENA_REG, value);
                this.esp.clock.schedule(() => this.checkInterrupt(), 100);
                return;
            case UART_INT_CLEAR_REG:
                this.clearRegisterBits(UART_INT_RAW_REG, value);
                this.checkInterrupt();
                this.esp.interrupt(this.irq, this.intStatus !== 0);
                return;
            case UART_CONF0_REG:
                super.writeUint32(addr, value);
                this.updateBaudRate();
                break;
            case UART_CONF1_REG:
                this.rxFullThreshold = value & 0x7f;
                this.txEmptyThreshold = (value >> 8) & 0x7f;
                break;
            case UART_CLKDIV_REG: {
                super.writeUint32(addr, value);
                this.updateBaudRate();
                return;
            }
        }
        super.writeUint32(addr, value);
    }
    reset() {
        super.reset();
        this.writeRegister(UART_CONF0_REG, UART_TICK_REF_ALWAYS_ON | (3 << UART_BIT_NUM_SHIFT) | (1 << UART_STOP_BIT_NUM_SHIFT));
        this.writeRegister(UART_CLKDIV_REG, 0x2b6);
        this.writeRegister(UART_AUTOBAUD_REG, 0x1000);
        this.writeRegister(UART_CONF1_REG, 0x6060);
        this.rxFIFO.splice(0, this.rxFIFO.length);
    }
}
exports.ESP8266UART = ESP8266UART;
//# sourceMappingURL=uart.js.map