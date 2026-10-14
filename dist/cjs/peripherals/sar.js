"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266SAR = void 0;
const base_peripheral_1 = require("./base-peripheral");
class ESP8266SAR extends base_peripheral_1.BasePeripheral {
    readUint32(addr) {
        switch (addr - this.baseAddr) {
            case 0x4: // fixes error: pll_cal exceeds 2ms!!!
                return 0xfdffffff;
            case 50: // read by ram_get_fm_sar_dout()
                return 0xff;
        }
        return super.readUint32(addr);
    }
}
exports.ESP8266SAR = ESP8266SAR;
//# sourceMappingURL=sar.js.map