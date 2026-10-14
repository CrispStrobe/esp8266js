"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266HDRF = void 0;
const base_peripheral_1 = require("./base-peripheral");
class ESP8266HDRF extends base_peripheral_1.BasePeripheral {
    readUint32(addr) {
        switch (addr - this.baseAddr) {
            case 0x7c: // read by rom_iq_est_enable()
                return 4294967295;
        }
        return super.readUint32(addr);
    }
}
exports.ESP8266HDRF = ESP8266HDRF;
//# sourceMappingURL=hdrf.js.map