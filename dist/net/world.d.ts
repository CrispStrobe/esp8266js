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
export declare const MAX_FRAME = 1514;
export declare const MIN_FRAME = 14;
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
/** An outside wire an access point can be bridged to (bw-board's hub and LAN have this shape). */
export interface ILink {
    attach(member: {
        deliver(frame: Uint8Array): void;
    }): unknown;
    send(frame: Uint8Array, from: unknown): void;
}
export type JoinResult = 'joined' | 'no such network' | 'wrong password';
export declare function macText(mac: Uint8Array): string;
export declare class NetWorld {
    private readonly accessPoints;
    private readonly bridges;
    /** Frames accepted from members, and frames handed to members. */
    readonly counters: {
        sent: number;
        delivered: number;
        refused: number;
    };
    /** Create an access point. An empty password means an open network. */
    addAccessPoint(ssid: string, password?: string): void;
    /** A member belongs to at most one access point; joining another leaves the first. */
    join(member: INetMember, ssid: string, password?: string): JoinResult;
    leave(member: INetMember): void;
    /** The access point `member` is on, or null. */
    networkOf(member: INetMember): string | null;
    /**
     * Send a frame from a member. Returns how many members it was handed to.
     * A frame from a non-member, or of an impossible length, is refused and
     * counted, not delivered.
     */
    send(from: INetMember, frame: Uint8Array): number;
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
    bridge(ssid: string, link: ILink): INetMember & {
        link?: unknown;
    };
    private fromWire;
    /**
     * Add a host-side station to an access point: `onFrame` gets what is
     * addressed to it. Throws if it cannot join; a station that silently was
     * not on the network would look like a broken world.
     */
    addStation(ssid: string, mac: Uint8Array, onFrame: (frame: Uint8Array, station: IStation) => void, password?: string): IStation;
}
