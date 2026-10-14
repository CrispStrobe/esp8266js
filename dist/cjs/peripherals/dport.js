"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266DPort = void 0;
const base_peripheral_1 = require("./base-peripheral");
const NMI_INT_ENABLE_REG = 0x00;
const EDGE_INT_ENABLE_REG = 0x04;
const CACHE_CTRL_REG = 0x0c;
const OTP_MAC0 = 0x50;
const OTP_MAC1 = 0x54;
const OTP_CHIPID = 0x58;
class ESP8266DPort extends base_peripheral_1.BasePeripheral {
    readUint32(addr) {
        const offset = addr - this.baseAddr;
        switch (offset) {
            case OTP_MAC0:
                return 0x42f00d42;
            case OTP_MAC1:
                return 0xf00d4244;
            case OTP_CHIPID:
                return 0x00008000;
        }
        return super.readUint32(addr);
    }
    writeUint32(addr, value) {
        const offset = addr - this.baseAddr;
        switch (offset) {
            case CACHE_CTRL_REG:
                if (value & 1) {
                    value |= 2;
                }
                this.writeRegister(CACHE_CTRL_REG, value);
                break;
            default:
                super.writeUint32(addr, value);
        }
    }
    reset() {
        super.reset();
    }
}
exports.ESP8266DPort = ESP8266DPort;
//# sourceMappingURL=dport.js.map