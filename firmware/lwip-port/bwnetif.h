/* lwIP network interface over the simulator's network device (net.c). */
#ifndef BW_NETIF_H
#define BW_NETIF_H
#include "lwip/netif.h"

/* For netif_add(): Ethernet interface with the device's address. The device must have joined a network. */
err_t bwnetif_init(struct netif *netif);
/* Hand waiting frames to lwIP. Call from the main loop; there is no receive interrupt. */
void bwnetif_poll(struct netif *netif);
/* Frames dropped on receive: too long for a frame, or no packet buffer free. */
extern unsigned int bwnetif_dropped;

#endif
