import { BasePeripheral } from './base-peripheral';
export class ESP8266WDev extends BasePeripheral {
    constructor() {
        super(...arguments);
        this.memory = new Uint8Array(0x2000);
        this.memoryView = new DataView(this.memory.buffer);
    }
    readUint32(addr) {
        const offset = addr - this.baseAddr;
        switch (offset) {
            case 0xc00: // The MAC's free-running microsecond counter: the SDK's system_get_time()
                return Math.floor(this.esp.clock.nanos / 1000) >>> 0;
            case 0xe44: // RNG, read by esp_random()
                return Math.floor(Math.random() * 4294967296);
        }
        return super.readUint32(addr);
    }
    writeUint32(addr, value) {
        const offset = addr - this.baseAddr;
        switch (offset) {
        }
        super.writeUint32(addr, value);
    }
}
//# sourceMappingURL=wdev.js.map