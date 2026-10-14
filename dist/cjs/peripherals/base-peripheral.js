"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnimplementedPeripheral = exports.BasePeripheral = exports.PeripheralBlockSize = void 0;
exports.PeripheralBlockSize = 4096; // bytes
class BasePeripheral {
    constructor(esp, baseAddr, name) {
        this.esp = esp;
        this.baseAddr = baseAddr;
        this.name = name;
        this.memory = new Uint8Array(exports.PeripheralBlockSize);
        this.memoryView = new DataView(this.memory.buffer);
    }
    readUint8(addr) {
        return this.memory[addr - this.baseAddr];
    }
    readUint16(addr) {
        return this.memoryView.getUint16(addr - this.baseAddr, true);
    }
    readUint32(addr) {
        return this.memoryView.getUint32(addr - this.baseAddr, true);
    }
    writeUint8(addr, value) {
        this.memory[addr - this.baseAddr] = value;
    }
    writeUint16(addr, value) {
        this.memoryView.setUint16(addr - this.baseAddr, value, true);
    }
    writeUint32(addr, value) {
        this.memoryView.setUint32(addr - this.baseAddr, value, true);
    }
    reset() {
        this.memory.fill(0);
    }
    readRegister(offset) {
        return this.memoryView.getUint32(offset, true);
    }
    writeRegister(offset, value) {
        this.memoryView.setUint32(offset, value, true);
    }
    setRegisterBits(offset, mask) {
        const newValue = this.readRegister(offset) | mask;
        this.writeRegister(offset, newValue);
        return newValue;
    }
    clearRegisterBits(offset, mask) {
        const newValue = this.readRegister(offset) & ~mask;
        this.writeRegister(offset, newValue);
        return newValue;
    }
}
exports.BasePeripheral = BasePeripheral;
class UnimplementedPeripheral extends BasePeripheral {
}
exports.UnimplementedPeripheral = UnimplementedPeripheral;
//# sourceMappingURL=base-peripheral.js.map