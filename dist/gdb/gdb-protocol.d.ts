import { ESP8266 } from '../esp8266';
import { Simulator } from '../sim/simulator';
export declare const gdbSIGINT: string;
export declare const gdbBreak: (thread: number) => string;
export declare function gdbChecksum(text: string): string;
export declare function gdb(simulator: Simulator, esp: ESP8266, cmd: string): string | null;
