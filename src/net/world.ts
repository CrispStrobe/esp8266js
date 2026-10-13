/**
 * A simulated Wi-Fi world: access points, and whatever is connected to them.
 *
 * WHAT IS MODELLED. Membership and delivery. A station joins an access point
 * by name and password; frames it sends reach the other members of that
 * access point: the one whose address is the destination, or everyone for a
 * broadcast or multicast destination. Frames are Ethernet II frames
 * (destination, source, type, payload), as a network stack sees them above a
 * Wi-Fi driver.
 *
 * WHAT IS NOT. No radio: no range, loss, channels, rates, retries or timing.
 * No 802.11 frames, no encryption on the air, no association handshake; the
 * password is only compared. Delivery is immediate and in order.
 *
 * Members are simulated boards (through their network device) and host-side
 * stations a test or an application adds with `addStation`: that is how
 * something that is not a board (a greeter, a server, a script) takes part.
 */

export const MAX_FRAME = 1514;
export const MIN_FRAME = 14;

/** Something that can receive frames: a board's network device, or a host-side station. */
export interface INetMember {
  readonly mac: Uint8Array;
  deliver(frame: Uint8Array): void;
}

export interface IStation extends INetMember {
  /** Send a frame to the other members of this station's access point. */
  send(frame: Uint8Array): void;
  leave(): void;
}

export type JoinResult = 'joined' | 'no such network' | 'wrong password';

function sameMac(a: Uint8Array, b: Uint8Array, offset = 0) {
  for (let i = 0; i < 6; i++) if (a[i] !== b[offset + i]) return false;
  return true;
}

export function macText(mac: Uint8Array) {
  return Array.from(mac.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join(':');
}

export class NetWorld {
  private readonly accessPoints = new Map<string, { password: string; members: Set<INetMember> }>();
  /** Frames accepted from members, and frames handed to members. */
  readonly counters = { sent: 0, delivered: 0, refused: 0 };

  /** Create an access point. An empty password means an open network. */
  addAccessPoint(ssid: string, password = '') {
    if (this.accessPoints.has(ssid)) throw new Error(`access point "${ssid}" already exists`);
    this.accessPoints.set(ssid, { password, members: new Set() });
  }

  /** A member belongs to at most one access point; joining another leaves the first. */
  join(member: INetMember, ssid: string, password = ''): JoinResult {
    const ap = this.accessPoints.get(ssid);
    if (!ap) return 'no such network';
    if (ap.password !== password) return 'wrong password';
    this.leave(member);
    ap.members.add(member);
    return 'joined';
  }

  leave(member: INetMember) {
    for (const ap of this.accessPoints.values()) ap.members.delete(member);
  }

  /** The access point `member` is on, or null. */
  networkOf(member: INetMember) {
    for (const [ssid, ap] of this.accessPoints) if (ap.members.has(member)) return ssid;
    return null;
  }

  /**
   * Send a frame from a member. Returns how many members it was handed to.
   * A frame from a non-member, or of an impossible length, is refused and
   * counted, not delivered.
   */
  send(from: INetMember, frame: Uint8Array) {
    const ssid = this.networkOf(from);
    if (ssid == null || frame.length < MIN_FRAME || frame.length > MAX_FRAME) {
      this.counters.refused++;
      return 0;
    }
    this.counters.sent++;
    const group = (frame[0] & 1) === 1;
    let handed = 0;
    for (const member of this.accessPoints.get(ssid)!.members) {
      if (member === from) continue;
      if (!group && !sameMac(member.mac, frame)) continue;
      member.deliver(frame.slice());
      handed++;
    }
    this.counters.delivered += handed;
    return handed;
  }

  /**
   * Add a host-side station to an access point: `onFrame` gets what is
   * addressed to it. Throws if it cannot join; a station that silently was
   * not on the network would look like a broken world.
   */
  addStation(
    ssid: string,
    mac: Uint8Array,
    onFrame: (frame: Uint8Array, station: IStation) => void,
    password = ''
  ): IStation {
    const station: IStation = {
      mac: mac.slice(0, 6),
      deliver: (frame) => onFrame(frame, station),
      send: (frame) => {
        this.send(station, frame);
      },
      leave: () => this.leave(station),
    };
    const result = this.join(station, ssid, password);
    if (result !== 'joined') throw new Error(`station ${macText(mac)} could not join "${ssid}": ${result}`);
    return station;
  }
}
