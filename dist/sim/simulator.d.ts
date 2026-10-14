/// <reference types="node" />
import { ESP8266 } from '../esp8266';
export declare class Simulator {
    readonly cpu: ESP8266;
    executeTimer: ReturnType<typeof setTimeout> | null;
    stopped: boolean;
    lastExecuted: number;
    throttle?: number;
    lastTime: bigint;
    constructor(cpu: ESP8266);
    execute(throttleDelta?: number): void;
    stop(): void;
    get executing(): boolean;
}
