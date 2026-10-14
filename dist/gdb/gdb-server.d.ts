import { ESP8266 } from '..';
import { Simulator } from '../sim/simulator';
export declare class GDBServer {
    constructor(simulator: Simulator, esp: ESP8266, port?: number);
}
