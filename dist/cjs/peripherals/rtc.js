"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESP8266RTC = void 0;
const base_peripheral_1 = require("./base-peripheral");
const RTC_RESET_REASON = 0x14;
class ESP8266RTC extends base_peripheral_1.BasePeripheral {
    readUint32(addr) {
        const offset = addr - this.baseAddr;
        switch (offset) {
            case 0x08:
                return 0;
            case RTC_RESET_REASON:
                return 4;
            case 0x18:
                return 5;
            case 0x28:
                return 1;
        }
        return super.readUint32(addr);
    }
}
exports.ESP8266RTC = ESP8266RTC;
//# sourceMappingURL=rtc.js.map