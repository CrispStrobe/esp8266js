/**
 * A network device for the simulated Wi-Fi world (src/net/world.ts).
 *
 * THIS IS NOT ESP8266 HARDWARE. The chip's own Wi-Fi is reachable only
 * through Espressif's radio libraries, which this project does not run. This
 * device sits in an unused block of the peripheral space (0x60000C00) and
 * exists only in the simulator, for firmware written to use it. Firmware can
 * tell: ID reads 'bwn1' here and 0 on a real chip.
 *
 * It is a link-layer device: whole Ethernet II frames in and out, so a real
 * TCP/IP stack can sit on top of it unchanged.
 *
 *   0x00 ID         RO  0x62776e31
 *   0x04 CTRL       RW  bit0 join the network named by SSID/PASSWORD; 0 leaves
 *                       bit1 interrupt when a frame is waiting
 *   0x08 STATUS     RO  bit0 joined, bit1 a received frame is waiting,
 *                       bit2 last join refused: no such network,
 *                       bit3 last join refused: wrong password
 *   0x0C MAC_LO     RO  address bytes 0..3 (byte 0 in the low byte)
 *   0x10 MAC_HI     RO  address bytes 4..5
 *   0x14 RX_LENGTH  RO  bytes in the waiting frame, 0 if none
 *   0x18 RX_DATA    RO  the next four bytes of it (first byte in the low byte)
 *   0x1C RX_DONE    WO  drop the waiting frame; the next one, if any, waits
 *   0x20 TX_DATA    WO  the next four bytes of a frame being built
 *   0x24 TX_SEND    WO  send the first <value> bytes built, and start afresh
 *   0x28 SSID       WO  append a character to the network name; 0 clears it
 *   0x2C PASSWORD   WO  append a character to the password; 0 clears it
 *   0x30 DROPPED    RO  frames lost because 16 were already waiting
 *
 * The interrupt is the one the fork's table names MAC (0). It follows
 * STATUS bit1 while CTRL bit1 is set.
 */
import { ESP8266Interrupts } from '../core/int';
import { ESP8266 } from '../esp8266';
import { INetMember, MAX_FRAME, NetWorld } from '../net/world';
import { BasePeripheral } from './base-peripheral';

export const BWNET_ID = 0x62776e31;
const QUEUE = 16;

const CTRL_JOIN = 1 << 0;
const CTRL_INTERRUPT = 1 << 1;
const STATUS_JOINED = 1 << 0;
const STATUS_RX = 1 << 1;
const STATUS_NO_NETWORK = 1 << 2;
const STATUS_WRONG_PASSWORD = 1 << 3;

export class BWNet extends BasePeripheral implements INetMember {
  readonly mac: Uint8Array;
  private ctrl = 0;
  private refusal = 0;
  private ssid = '';
  private password = '';
  private readonly rx: Uint8Array[] = [];
  private rxAt = 0;
  private tx: number[] = [];
  private dropped = 0;

  constructor(esp: ESP8266, baseAddr: number, name: string, private world?: NetWorld, mac?: Uint8Array) {
    super(esp, baseAddr, name);
    // Locally administered, unicast: 02:62:77 ("bw") and three bytes the caller chooses.
    this.mac = mac ? mac.slice(0, 6) : Uint8Array.from([0x02, 0x62, 0x77, 0x00, 0x00, 0x01]);
  }

  /** A frame from the world. */
  deliver(frame: Uint8Array) {
    if (this.rx.length >= QUEUE) {
      this.dropped++;
      return;
    }
    this.rx.push(frame);
    this.updateInterrupt();
  }

  private get joined() {
    return !!this.world && this.world.networkOf(this) != null;
  }

  private updateInterrupt() {
    this.esp.interrupt(ESP8266Interrupts.MAC, !!(this.ctrl & CTRL_INTERRUPT) && this.rx.length > 0);
  }

  reset() {
    super.reset();
    this.world?.leave(this);
    this.ctrl = 0;
    this.refusal = 0;
    this.ssid = '';
    this.password = '';
    this.rx.length = 0;
    this.rxAt = 0;
    this.tx = [];
  }

  readUint32(addr: number) {
    const { mac } = this;
    switch (addr - this.baseAddr) {
      case 0x00:
        return BWNET_ID;
      case 0x04:
        return this.ctrl;
      case 0x08:
        return (
          (this.joined ? STATUS_JOINED : 0) | (this.rx.length ? STATUS_RX : 0) | this.refusal
        );
      case 0x0c:
        return (mac[0] | (mac[1] << 8) | (mac[2] << 16) | (mac[3] << 24)) >>> 0;
      case 0x10:
        return mac[4] | (mac[5] << 8);
      case 0x14:
        return this.rx.length ? this.rx[0].length : 0;
      case 0x18: {
        const frame = this.rx[0];
        if (!frame) return 0;
        let word = 0;
        for (let i = 0; i < 4; i++) word |= (frame[this.rxAt + i] ?? 0) << (8 * i);
        this.rxAt += 4;
        return word >>> 0;
      }
      case 0x30:
        return this.dropped;
    }
    return 0;
  }

  writeUint32(addr: number, value: number) {
    switch (addr - this.baseAddr) {
      case 0x04: {
        const wasJoining = this.ctrl & CTRL_JOIN;
        this.ctrl = value & (CTRL_JOIN | CTRL_INTERRUPT);
        if (this.ctrl & CTRL_JOIN && !wasJoining) {
          const result = this.world ? this.world.join(this, this.ssid, this.password) : 'no such network';
          this.refusal =
            result === 'joined' ? 0 : result === 'wrong password' ? STATUS_WRONG_PASSWORD : STATUS_NO_NETWORK;
        } else if (!(this.ctrl & CTRL_JOIN) && wasJoining) {
          this.world?.leave(this);
        }
        this.updateInterrupt();
        break;
      }
      case 0x1c:
        this.rx.shift();
        this.rxAt = 0;
        this.updateInterrupt();
        break;
      case 0x20:
        if (this.tx.length < MAX_FRAME + 3) {
          for (let i = 0; i < 4; i++) this.tx.push((value >>> (8 * i)) & 0xff);
        }
        break;
      case 0x24: {
        const length = Math.min(value >>> 0, this.tx.length);
        const frame = Uint8Array.from(this.tx.slice(0, length));
        this.tx = [];
        this.world?.send(this, frame);
        break;
      }
      case 0x28:
        this.ssid = value & 0xff ? this.ssid + String.fromCharCode(value & 0xff) : '';
        break;
      case 0x2c:
        this.password = value & 0xff ? this.password + String.fromCharCode(value & 0xff) : '';
        break;
    }
  }

  readUint8(addr: number) {
    return (this.readUint32(addr & ~3) >>> (8 * (addr & 3))) & 0xff;
  }
}
