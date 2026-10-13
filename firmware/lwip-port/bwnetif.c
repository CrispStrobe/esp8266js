/*
 * lwIP network interface over the simulator's network device.
 *
 * The device carries whole Ethernet II frames, so this is an ordinary lwIP
 * Ethernet driver: a frame out is copied from the packet buffer chain to the
 * device, a frame in is copied from the device to a pool buffer and given to
 * ethernet_input. Receiving is polled from the main loop.
 */
#include "lwip/opt.h"
#include "lwip/etharp.h"
#include "lwip/netif.h"
#include "lwip/pbuf.h"
#include "bw8266.h"
#include "bwnetif.h"

#define FRAME_MAX 1514
/* Frames handed to lwIP per poll, so a busy network cannot starve the timers. */
#define FRAMES_PER_POLL 4

static unsigned char tx[FRAME_MAX];
static unsigned char rx[FRAME_MAX];
unsigned int bwnetif_dropped;

static err_t link_output(struct netif *netif, struct pbuf *p) {
  (void)netif;
  if (p->tot_len > sizeof tx) return ERR_BUF;
  pbuf_copy_partial(p, tx, p->tot_len, 0);
  bw_net_send(tx, p->tot_len);
  return ERR_OK;
}

err_t bwnetif_init(struct netif *netif) {
  netif->name[0] = 'b';
  netif->name[1] = 'w';
  netif->output = etharp_output;
  netif->linkoutput = link_output;
  netif->mtu = 1500;
  netif->hwaddr_len = 6;
  bw_net_mac(netif->hwaddr);
  netif->flags = NETIF_FLAG_BROADCAST | NETIF_FLAG_ETHARP | NETIF_FLAG_ETHERNET;
  return ERR_OK;
}

void bwnetif_poll(struct netif *netif) {
  for (int i = 0; i < FRAMES_PER_POLL; i++) {
    u32 length = bw_net_receive(rx, sizeof rx);
    if (!length) return;
    struct pbuf *p = length <= sizeof rx ? pbuf_alloc(PBUF_RAW, (u16_t)length, PBUF_POOL) : 0;
    if (!p) {
      bwnetif_dropped++;
      continue;
    }
    pbuf_take(p, rx, (u16_t)length);
    if (netif->input(p, netif) != ERR_OK) pbuf_free(p);
  }
}
