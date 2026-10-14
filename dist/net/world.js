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
function sameMac(a, b, offset = 0) {
    for (let i = 0; i < 6; i++)
        if (a[i] !== b[offset + i])
            return false;
    return true;
}
export function macText(mac) {
    return Array.from(mac.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join(':');
}
export class NetWorld {
    constructor() {
        this.accessPoints = new Map();
        this.bridges = new Map();
        /** Frames accepted from members, and frames handed to members. */
        this.counters = { sent: 0, delivered: 0, refused: 0 };
    }
    /** Create an access point. An empty password means an open network. */
    addAccessPoint(ssid, password = '') {
        if (this.accessPoints.has(ssid))
            throw new Error(`access point "${ssid}" already exists`);
        this.accessPoints.set(ssid, { password, members: new Set() });
    }
    /** A member belongs to at most one access point; joining another leaves the first. */
    join(member, ssid, password = '') {
        const ap = this.accessPoints.get(ssid);
        if (!ap)
            return 'no such network';
        if (ap.password !== password)
            return 'wrong password';
        this.leave(member);
        ap.members.add(member);
        return 'joined';
    }
    leave(member) {
        for (const ap of this.accessPoints.values())
            ap.members.delete(member);
    }
    /** The access point `member` is on, or null. */
    networkOf(member) {
        for (const [ssid, ap] of this.accessPoints)
            if (ap.members.has(member))
                return ssid;
        return null;
    }
    /**
     * Send a frame from a member. Returns how many members it was handed to.
     * A frame from a non-member, or of an impossible length, is refused and
     * counted, not delivered.
     */
    send(from, frame) {
        const ssid = this.networkOf(from);
        if (ssid == null || frame.length < MIN_FRAME || frame.length > MAX_FRAME) {
            this.counters.refused++;
            return 0;
        }
        this.counters.sent++;
        const group = (frame[0] & 1) === 1;
        let handed = 0;
        for (const member of this.accessPoints.get(ssid).members) {
            if (member === from)
                continue;
            const wire = this.bridges.get(member);
            if (wire) {
                // The wire is a hub: it gets every frame and its own members filter.
                wire.send(frame.slice(), member);
                handed++;
                continue;
            }
            if (!group && !sameMac(member.mac, frame))
                continue;
            member.deliver(frame.slice());
            handed++;
        }
        this.counters.delivered += handed;
        return handed;
    }
    /**
     * Join an access point to an outside wire, so that its members and the
     * wire's hear each other. `link` is anything with `attach(member)` and
     * `send(frame, from)` that gives members frames through `deliver(frame)`:
     * the shape of bw-board's NE2000 hub and shared LAN, which is how a board
     * here shares a network with an emulated PC or a host-side IPv4 node there.
     *
     * The access point stays what it is: it delivers by destination address.
     * Frames from the wire are delivered the same way, so a frame for a station
     * that is not on this access point goes nowhere.
     */
    bridge(ssid, link) {
        const ap = this.accessPoints.get(ssid);
        if (!ap)
            throw new Error(`cannot bridge "${ssid}": no such access point`);
        // To the wire the whole access point is one member; to the access point the wire is one.
        const port = {
            mac: Uint8Array.from([0, 0, 0, 0, 0, 0]),
            deliver: (frame) => this.fromWire(ap, port, frame),
        };
        this.bridges.set(port, link);
        ap.members.add(port);
        link.attach(port);
        return port;
    }
    fromWire(ap, port, frame) {
        if (frame.length < MIN_FRAME || frame.length > MAX_FRAME) {
            this.counters.refused++;
            return;
        }
        const group = (frame[0] & 1) === 1;
        for (const member of ap.members) {
            if (member === port || this.bridges.has(member))
                continue;
            if (!group && !sameMac(member.mac, frame))
                continue;
            member.deliver(frame.slice());
            this.counters.delivered++;
        }
    }
    /**
     * Add a host-side station to an access point: `onFrame` gets what is
     * addressed to it. Throws if it cannot join; a station that silently was
     * not on the network would look like a broken world.
     */
    addStation(ssid, mac, onFrame, password = '') {
        const station = {
            mac: mac.slice(0, 6),
            deliver: (frame) => onFrame(frame, station),
            send: (frame) => {
                this.send(station, frame);
            },
            leave: () => this.leave(station),
        };
        const result = this.join(station, ssid, password);
        if (result !== 'joined')
            throw new Error(`station ${macText(mac)} could not join "${ssid}": ${result}`);
        return station;
    }
}
//# sourceMappingURL=world.js.map