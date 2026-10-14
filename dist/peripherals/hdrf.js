import { BasePeripheral } from './base-peripheral';
export class ESP8266HDRF extends BasePeripheral {
    readUint32(addr) {
        switch (addr - this.baseAddr) {
            case 0x7c: // read by rom_iq_est_enable()
                return 4294967295;
        }
        return super.readUint32(addr);
    }
}
//# sourceMappingURL=hdrf.js.map