export function hexByte(value) {
    return ((value >> 4) & 0xf).toString(16) + (value & 0xf).toString(16);
}
export function hex16(value) {
    return hexByte(value >> 8) + hexByte(value);
}
export function hex32(value) {
    return hexByte(value >> 24) + hexByte(value >> 16) + hexByte(value >> 8) + hexByte(value);
}
export function unhexlify(hex) {
    const result = new Uint8Array(hex.length / 2);
    for (let i = 0; i < result.length; i++) {
        result[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return result;
}
export function hexlify(data) {
    return Array.from(data).map(hexByte).join('');
}
//# sourceMappingURL=hex.js.map