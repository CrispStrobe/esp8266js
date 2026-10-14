import { ESP8266 } from '../esp8266';
import { BasePeripheral } from './base-peripheral';
/** Look for register offsets in esptool_py/esptool/flasher_stub/include/soc_support.h */
export interface ISPIConfig {
    /** Whether this SPI interface is wired to the SPI Flash */
    flash: boolean;
    irq: number;
}
export declare class ESP8266SPI extends BasePeripheral {
    readonly config: ISPIConfig;
    private statusReg;
    private transactionBuffer;
    private transactionActive;
    readonly flashId: number;
    onTransmit: (buffer: Uint8Array) => void;
    constructor(esp: ESP8266, baseAddr: number, name: string, config: ISPIConfig);
    get clockNanos(): number;
    readUint32(addr: number): number;
    writeUint32(addr: number, value: number): void;
    flashCmdWrite(cmd: number): void;
    startTransaction(): void;
    completeTransmit(): void;
    private eraseFlash;
    flashCommand(cmd: number, addr: number, sendBytes: number, recvBytes: number): void;
    updateInterrupt(): void;
    reset(): void;
}
