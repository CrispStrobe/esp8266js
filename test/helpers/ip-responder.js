/**
 * TEST SCAFFOLDING, not a network stack: the other end of the one exchange
 * firmware/net-ip.c makes, as a host-side station of the simulated Wi-Fi
 * world. It answers
 *   - ARP requests for its own address,
 *   - DHCP: DISCOVER with an OFFER, REQUEST with an ACK (or a NAK), always
 *     the same one client address, with subnet mask, router and DNS server
 *     (router and DNS server are itself),
 *   - DNS: an A query for its one name; any other question gets "no such name",
 *   - TCP on port 80: one HTTP request per connection, answered and closed.
 *
 * Frames are parsed and built by hand from the header layouts of RFC 826
 * (ARP), 791 (IPv4), 768 (UDP), 793 (TCP), 2131/2132 (DHCP) and 1035 (DNS).
 * IPv4 header and TCP checksums are computed and, on arrival, checked; the
 * UDP checksum is sent as 0 ("none") and checked on arrival when present.
 *
 * What it does not do: retransmit, time anything out, reassemble fragments,
 * reorder segments, honour windows, or serve more than it is asked here. The
 * world it lives in delivers every frame at once and in order.
 *
 * `log` lists what happened, in order; `problems` lists frames it could not
 * accept (bad checksum, unexpected segment). A test asserts on both.
 */

const ETH_ARP = 0x0806;
const ETH_IPV4 = 0x0800;
const PROTO_TCP = 6;
const PROTO_UDP = 17;
const FIN = 1, SYN = 2, RST = 4, PSH = 8, ACK = 16;
const BROADCAST_MAC = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const DHCP_MAGIC = 0x63825363;

const be16 = (b, at) => (b[at] << 8) | b[at + 1];
const be32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const put16 = (v) => [(v >>> 8) & 0xff, v & 0xff];
const put32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const ipBytes = (text) => text.split('.').map(Number);
const ipText = (b, at = 0) => Array.from(b.slice(at, at + 4)).join('.');
const same = (b, at, bytes) => bytes.every((v, i) => b[at + i] === v);

/** The Internet checksum (RFC 1071) of `bytes`: the one's complement of their one's complement sum. */
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) | (bytes[i + 1] ?? 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 0x10000);
  return ~sum & 0xffff;
}

/** The pseudo-header TCP and UDP checksums cover, followed by the segment itself. */
function withPseudoHeader(source, destination, protocol, segment) {
  return [...source, ...destination, 0, protocol, ...put16(segment.length), ...segment];
}

class IpResponder {
  /**
   * @param {{ mac: Uint8Array, ip: string, clientIp: string, netmask: string, name: string,
   *           body: (request: { method: string, path: string, host: string }) => string }} options
   */
  constructor(options) {
    this.mac = Array.from(options.mac);
    this.ip = ipBytes(options.ip);
    this.clientIp = ipBytes(options.clientIp);
    this.netmask = ipBytes(options.netmask);
    this.name = options.name;
    this.body = options.body;
    this.log = [];
    this.problems = [];
    this.connections = new Map();
    this.ipId = 1;
    this.station = null;
  }

  /** Join `ssid` of a NetWorld (src/net/world.ts) as a station. */
  attach(world, ssid, password = '') {
    this.station = world.addStation(ssid, Uint8Array.from(this.mac), (frame) => this.receive(frame), password);
    return this;
  }

  receive(frame) {
    if (frame.length < 14) return;
    const type = be16(frame, 12);
    if (type === ETH_ARP) this.arp(frame);
    else if (type === ETH_IPV4) this.ipv4(frame);
  }

  send(destinationMac, type, payload) {
    this.station.send(Uint8Array.from([...destinationMac, ...this.mac, ...put16(type), ...payload]));
  }

  // ── ARP (RFC 826): hardware type 1, protocol 0x0800, lengths 6 and 4, operation, then
  //    sender hardware, sender protocol, target hardware, target protocol address ──
  arp(frame) {
    const a = frame.subarray(14);
    if (a.length < 28 || be16(a, 0) !== 1 || be16(a, 2) !== ETH_IPV4 || a[4] !== 6 || a[5] !== 4) return;
    if (be16(a, 6) !== 1 || !same(a, 24, this.ip)) return; // not a request for our address
    const senderMac = Array.from(a.subarray(8, 14));
    const senderIp = Array.from(a.subarray(14, 18));
    this.log.push(`arp who-has ${ipText(this.ip)} from ${ipText(senderIp)}`);
    this.send(senderMac, ETH_ARP, [
      ...put16(1), ...put16(ETH_IPV4), 6, 4, ...put16(2), ...this.mac, ...this.ip, ...senderMac, ...senderIp,
    ]);
  }

  // ── IPv4 (RFC 791) ──
  ipv4(frame) {
    const p = frame.subarray(14);
    if (p.length < 20 || p[0] >> 4 !== 4) return;
    const headerLength = (p[0] & 15) * 4;
    const totalLength = be16(p, 2);
    if (headerLength < 20 || totalLength < headerLength || totalLength > p.length) {
      this.problems.push('an IPv4 packet with impossible lengths');
      return;
    }
    if (checksum(p.subarray(0, headerLength)) !== 0) {
      this.problems.push('an IPv4 packet with a wrong header checksum');
      return;
    }
    if (be16(p, 6) & 0x3fff) {
      this.problems.push('an IPv4 fragment');
      return;
    }
    const packet = {
      sourceMac: Array.from(frame.subarray(6, 12)),
      source: Array.from(p.subarray(12, 16)),
      destination: Array.from(p.subarray(16, 20)),
      payload: p.subarray(headerLength, totalLength),
    };
    const forUs = same(packet.destination, 0, this.ip);
    const broadcast = same(packet.destination, 0, [255, 255, 255, 255]);
    if (p[9] === PROTO_UDP && (forUs || broadcast)) this.udp(packet);
    else if (p[9] === PROTO_TCP && forUs) this.tcp(packet);
  }

  sendIpv4(destinationMac, destination, protocol, payload) {
    const header = [
      0x45, 0, ...put16(20 + payload.length), ...put16(this.ipId++), 0x40, 0, 64, protocol, 0, 0,
      ...this.ip, ...destination,
    ];
    header.splice(10, 2, ...put16(checksum(header)));
    this.send(destinationMac, ETH_IPV4, [...header, ...payload]);
  }

  // ── UDP (RFC 768): source port, destination port, length, checksum ──
  udp(packet) {
    const u = packet.payload;
    if (u.length < 8 || be16(u, 4) < 8 || be16(u, 4) > u.length) return;
    const datagram = u.subarray(0, be16(u, 4));
    if (be16(u, 6) !== 0 && checksum(withPseudoHeader(packet.source, packet.destination, PROTO_UDP, datagram)) !== 0) {
      this.problems.push('a UDP datagram with a wrong checksum');
      return;
    }
    const [sourcePort, port, data] = [be16(u, 0), be16(u, 2), datagram.subarray(8)];
    if (port === 67 && sourcePort === 68) this.dhcp(data);
    else if (port === 53 && same(packet.destination, 0, this.ip)) this.dns(packet, sourcePort, data);
  }

  sendUdp(destinationMac, destination, sourcePort, port, data) {
    // Checksum 0: "the transmitter generated no checksum" (RFC 768).
    this.sendIpv4(destinationMac, destination, PROTO_UDP, [
      ...put16(sourcePort), ...put16(port), ...put16(8 + data.length), 0, 0, ...data,
    ]);
  }

  // ── DHCP (RFC 2131): op, htype, hlen, hops, xid, secs, flags, ciaddr, yiaddr, siaddr,
  //    giaddr, chaddr[16], sname[64], file[128], magic cookie, options (RFC 2132) ──
  dhcp(m) {
    if (m.length < 240 || m[0] !== 1 || be32(m, 236) !== DHCP_MAGIC) return;
    const options = new Map();
    for (let at = 240; at < m.length && m[at] !== 255; ) {
      if (m[at] === 0) { at++; continue; }
      options.set(m[at], m.subarray(at + 2, at + 2 + m[at + 1]));
      at += 2 + m[at + 1];
    }
    const kind = options.get(53)?.[0];
    let reply;
    if (kind === 1) {
      this.log.push('dhcp discover');
      reply = 2; // OFFER
    } else if (kind === 3) {
      const wanted = options.get(50) ?? m.subarray(12, 16); // requested address, or ciaddr when renewing
      const server = options.get(54);
      if (server && !same(server, 0, this.ip)) return; // the client chose another server
      const ok = same(wanted, 0, this.clientIp);
      this.log.push(`dhcp request ${ipText(wanted)}`);
      reply = ok ? 5 : 6; // ACK : NAK
    } else {
      return;
    }
    const out = new Array(240).fill(0);
    out[0] = 2; // BOOTREPLY
    out[1] = 1; // Ethernet
    out[2] = 6;
    out.splice(4, 4, ...m.subarray(4, 8)); // the client's transaction id
    out.splice(10, 2, ...m.subarray(10, 12)); // and its flags
    if (reply !== 6) out.splice(16, 4, ...this.clientIp); // yiaddr
    out.splice(20, 4, ...this.ip); // siaddr
    out.splice(28, 16, ...m.subarray(28, 44)); // chaddr
    out.splice(236, 4, ...put32(DHCP_MAGIC));
    out.push(53, 1, reply, 54, 4, ...this.ip);
    if (reply !== 6) {
      out.push(51, 4, ...put32(3600), 1, 4, ...this.netmask, 3, 4, ...this.ip, 6, 4, ...this.ip);
    }
    out.push(255);
    while (out.length < 300) out.push(0); // the BOOTP minimum
    // To everyone: the client has no address to be reached at yet.
    this.sendUdp(BROADCAST_MAC, [255, 255, 255, 255], 67, 68, out);
  }

  // ── DNS (RFC 1035): id, flags, counts of questions / answers / authority / additional,
  //    then the question: name as length-prefixed labels, type, class ──
  dns(packet, sourcePort, q) {
    if (q.length < 17 || q[2] & 0x80 || be16(q, 4) !== 1) return;
    const labels = [];
    let at = 12;
    while (at < q.length && q[at] !== 0) {
      if (q[at] > 63 || at + 1 + q[at] > q.length) return;
      labels.push(String.fromCharCode(...q.subarray(at + 1, at + 1 + q[at])));
      at += 1 + q[at];
    }
    if (at + 5 > q.length) return;
    const name = labels.join('.');
    const [type, klass] = [be16(q, at + 1), be16(q, at + 3)];
    const question = Array.from(q.subarray(12, at + 5));
    const known = name.toLowerCase() === this.name && type === 1 && klass === 1;
    this.log.push(`dns ${type === 1 ? 'A' : `type ${type}`} ${name}`);
    const reply = [
      q[0], q[1], // the client's id
      0x84 | (q[2] & 1), known ? 0x80 : 0x83, // response, authoritative, recursion as asked and available; rcode
      0, 1, 0, known ? 1 : 0, 0, 0, 0, 0,
      ...question,
    ];
    // The answer: a pointer to the name at offset 12, type A, class IN, time to live, 4 bytes of address.
    if (known) reply.push(0xc0, 12, 0, 1, 0, 1, ...put32(60), 0, 4, ...this.ip);
    this.sendUdp(packet.sourceMac, packet.source, 53, sourcePort, reply);
  }

  // ── TCP (RFC 793): source port, destination port, sequence, acknowledgment,
  //    data offset and flags, window, checksum, urgent pointer, options ──
  tcp(packet) {
    const t = packet.payload;
    if (t.length < 20) return;
    if (checksum(withPseudoHeader(packet.source, packet.destination, PROTO_TCP, t)) !== 0) {
      this.problems.push('a TCP segment with a wrong checksum');
      return;
    }
    const [peerPort, port, seq, ack, flags] = [be16(t, 0), be16(t, 2), be32(t, 4), be32(t, 8), t[13]];
    const data = t.subarray((t[12] >> 4) * 4);
    const key = `${ipText(packet.source)}:${peerPort}`;
    let c = this.connections.get(key);
    const reply = (replyFlags, sequence, payload = [], options = []) =>
      this.sendTcp(packet, port, peerPort, sequence, c ? c.receiveNext : (seq + data.length + (flags & SYN ? 1 : 0)) >>> 0, replyFlags, payload, options);

    if (flags & RST) {
      if (c) {
        this.log.push('tcp reset by the client');
        this.connections.delete(key);
      }
      return;
    }
    if (port !== 80) {
      reply(RST | ACK, 0);
      return;
    }
    if (flags & SYN && !(flags & ACK)) {
      if (!c) {
        // Our initial sequence number: any value; this one makes a trace easy to read.
        c = { initial: 0x00010000, sendNext: 0x00010001, receiveNext: (seq + 1) >>> 0, request: '', state: 'opening', answered: false };
        this.connections.set(key, c);
        this.log.push('tcp syn');
      }
      // With the option "maximum segment size 1460".
      reply(SYN | ACK, c.initial, [], [2, 4, ...put16(1460)]);
      return;
    }
    if (!c) {
      this.problems.push(`a TCP segment (flags 0x${flags.toString(16)}) for no connection`);
      this.sendTcp(packet, port, peerPort, ack, 0, RST, [], []);
      return;
    }
    if (flags & ACK && c.state === 'opening' && ack === c.sendNext) {
      c.state = 'open';
      this.log.push('tcp established');
    }
    if (flags & ACK && c.state === 'closing' && ack === c.sendNext && !c.finAcknowledged) {
      c.finAcknowledged = true;
      this.log.push('tcp our fin acknowledged');
    }
    let acknowledge = false;
    if (data.length) {
      if (seq === c.receiveNext) {
        c.receiveNext = (c.receiveNext + data.length) >>> 0;
        c.request += String.fromCharCode(...data);
      } else if (((seq - c.receiveNext) | 0) > 0) {
        this.problems.push('a TCP segment ahead of what was received');
      }
      acknowledge = true; // new data, or a repeat whose acknowledgment was presumably lost
    }
    if (flags & FIN) {
      if (((seq + data.length) >>> 0) === c.receiveNext && !c.peerClosed) {
        c.receiveNext = (c.receiveNext + 1) >>> 0;
        c.peerClosed = true;
        this.log.push('tcp fin from the client');
      }
      acknowledge = true;
    }
    if (acknowledge) reply(ACK, c.sendNext);
    if (!c.answered && c.request.includes('\r\n\r\n')) {
      c.answered = true;
      const response = Array.from(Buffer.from(this.http(c.request), 'latin1'));
      reply(PSH | ACK, c.sendNext, response);
      c.sendNext = (c.sendNext + response.length) >>> 0;
      // HTTP/1.0: the end of the response is the end of the connection.
      reply(FIN | ACK, c.sendNext);
      c.sendNext = (c.sendNext + 1) >>> 0;
      c.state = 'closing';
    }
    if (c.peerClosed && c.finAcknowledged) {
      this.connections.delete(key);
      this.log.push('tcp closed');
    }
  }

  sendTcp(packet, sourcePort, port, seq, ack, flags, data, options) {
    const offset = 20 + options.length;
    if (offset % 4) throw new Error('TCP options must fill whole 32-bit words');
    const segment = [
      ...put16(sourcePort), ...put16(port), ...put32(seq), ...put32(ack),
      (offset / 4) << 4, flags, ...put16(8192), 0, 0, 0, 0, ...options, ...data,
    ];
    segment.splice(16, 2, ...put16(checksum(withPseudoHeader(this.ip, packet.source, PROTO_TCP, segment))));
    this.sendIpv4(packet.sourceMac, packet.source, PROTO_TCP, segment);
  }

  /** One HTTP/1.0 exchange: "METHOD path HTTP/1.x", headers, blank line. */
  http(request) {
    const [first, ...headers] = request.split('\r\n\r\n')[0].split('\r\n');
    const [method, path] = first.split(' ');
    const host = headers.map((h) => /^host:\s*(.*)$/i.exec(h)).find(Boolean)?.[1] ?? '';
    this.log.push(`http ${method} ${path} host ${host}`);
    const page = method === 'GET' ? this.body({ method, path, host }) : null;
    const body = page ?? 'not found\n';
    return (
      `HTTP/1.0 ${page == null ? '404 Not Found' : '200 OK'}\r\nContent-Type: text/plain\r\n` +
      `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`
    );
  }
}

module.exports = { IpResponder, checksum };
