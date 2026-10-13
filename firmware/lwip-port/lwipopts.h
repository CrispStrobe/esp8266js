/*
 * lwIP configuration for the bw8266 runtime: no operating system, the raw
 * (callback) API only, IPv4 only, one Ethernet-style interface.
 *
 * Memory is sized for the 80 KB of data RAM in bw8266.ld: the heap and the
 * packet pool below come to about 36 KB, all of it static.
 */
#ifndef BW_LWIPOPTS_H
#define BW_LWIPOPTS_H

/* No threads: everything runs from the program's main loop. */
#define NO_SYS 1
#define LWIP_SOCKET 0
#define LWIP_NETCONN 0
/* Nothing touches the stack from an interrupt (the driver is polled), so no critical sections. */
#define SYS_LIGHTWEIGHT_PROT 0

/* Protocols */
#define LWIP_IPV4 1
#define LWIP_IPV6 0
#define LWIP_ETHERNET 1
#define LWIP_ARP 1
#define LWIP_ICMP 1
#define LWIP_UDP 1
#define LWIP_TCP 1
#define LWIP_DHCP 1
#define LWIP_DNS 1
#define LWIP_RAW 0
#define LWIP_IGMP 0
#define LWIP_AUTOIP 0
/*
 * The DHCP client does not probe its new address for a conflict before using
 * it. With the probe, binding takes several seconds of ARP probing; here the
 * address is used as soon as the server acknowledges it.
 */
#define LWIP_ACD 0
#define LWIP_DHCP_DOES_ACD_CHECK 0
#define IP_REASSEMBLY 0
#define IP_FRAG 0
#define LWIP_NETIF_STATUS_CALLBACK 0
#define LWIP_NETIF_LINK_CALLBACK 0
#define LWIP_STATS 0

/* Memory: lwIP's own heap and pools, no malloc. */
#define MEM_LIBC_MALLOC 0
#define MEMP_MEM_MALLOC 0
#define MEM_ALIGNMENT 4
#define MEM_SIZE (12 * 1024)
#define MEMP_NUM_PBUF 16
#define MEMP_NUM_UDP_PCB 6
#define MEMP_NUM_TCP_PCB 4
#define MEMP_NUM_TCP_PCB_LISTEN 2
#define MEMP_NUM_TCP_SEG 16
#define PBUF_POOL_SIZE 14

/* TCP: full-size segments, a window of four of them. */
#define TCP_MSS 1460
#define TCP_WND (4 * TCP_MSS)
#define TCP_SND_BUF (2 * TCP_MSS)
#define TCP_SND_QUEUELEN 8
#define TCP_QUEUE_OOSEQ 0
#define LWIP_TCP_SACK_OUT 0

/* DNS: a few short names at a time. */
#define DNS_TABLE_SIZE 2
#define DNS_MAX_NAME_LENGTH 64
#define DNS_MAX_SERVERS 2

#endif
