"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hexlify = exports.unhexlify = exports.hex32 = exports.hex16 = exports.hexByte = void 0;
function hexByte(value) {
    return ((value >> 4) & 0xf).toString(16) + (value & 0xf).toString(16);
}
exports.hexByte = hexByte;
function hex16(value) {
    return hexByte(value >> 8) + hexByte(value);
}
exports.hex16 = hex16;
function hex32(value) {
    return hexByte(value >> 24) + hexByte(value >> 16) + hexByte(value >> 8) + hexByte(value);
}
exports.hex32 = hex32;
function unhexlify(hex) {
    const result = new Uint8Array(hex.length / 2);
    for (let i = 0; i < result.length; i++) {
        result[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return result;
}
exports.unhexlify = unhexlify;
function hexlify(data) {
    return Array.from(data).map(hexByte).join('');
}
exports.hexlify = hexlify;
//# sourceMappingURL=hex.js.map