"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GDBServer = void 0;
const net_1 = require("net");
const gdb_protocol_1 = require("./gdb-protocol");
const DEBUG = false;
class GDBServer {
    constructor(simulator, esp, port = 3333) {
        const server = (0, net_1.createServer)();
        server.listen(port, '0.0.0.0');
        server.on('connection', (socket) => {
            simulator.stop();
            let buf = '';
            socket.setNoDelay(true);
            socket.on('data', (data) => {
                if (data[0] === 3) {
                    console.log('BREAK');
                    simulator.stop();
                    socket.write(gdb_protocol_1.gdbSIGINT);
                    data = data.slice(1);
                }
                esp.onBreak = (core) => {
                    core.nextPC = core.PC;
                    simulator.stop();
                    socket.write((0, gdb_protocol_1.gdbBreak)(1));
                };
                buf += data.toString('utf-8');
                for (;;) {
                    const dolla = buf.indexOf('$');
                    const hash = buf.indexOf('#');
                    if (dolla < 0 || hash < 0 || hash < dolla || hash + 2 > buf.length) {
                        return;
                    }
                    const cmd = buf.substr(dolla + 1, hash - dolla - 1);
                    const cksum = buf.substr(hash + 1, 2);
                    buf = buf.substr(hash + 2);
                    if ((0, gdb_protocol_1.gdbChecksum)(cmd) !== cksum) {
                        console.warn('Warning: GDB checksum error in message:', cmd);
                        socket.write('-');
                    }
                    else {
                        socket.write('+');
                        if (DEBUG) {
                            console.log('>', cmd);
                        }
                        const reply = (0, gdb_protocol_1.gdb)(simulator, esp, cmd);
                        if (reply) {
                            if (DEBUG) {
                                console.log('<', reply);
                            }
                            socket.write(reply);
                        }
                    }
                }
            });
        });
    }
}
exports.GDBServer = GDBServer;
//# sourceMappingURL=gdb-server.js.map