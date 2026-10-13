/*
 * Join the network "bw-world", get an address by DHCP, look up museum.lan by
 * DNS, fetch http://museum.lan/hall and print the first line of what comes
 * back. The TCP/IP stack is lwIP (lwip-port/), over the simulator's network
 * device. Each step prints one line; a step that fails prints "error: ..."
 * naming the step, and the program stops.
 */
#include <string.h>
#include "lwip/dhcp.h"
#include "lwip/dns.h"
#include "lwip/init.h"
#include "lwip/ip4_addr.h"
#include "lwip/netif.h"
#include "lwip/tcp.h"
#include "lwip/timeouts.h"
#include "netif/ethernet.h"
#include "bw8266.h"
#include "bwnetif.h"

#define HOST "museum.lan"
static const char REQUEST[] = "GET /hall HTTP/1.0\r\nHost: " HOST "\r\n\r\n";

static struct netif netif;
static ip_addr_t server;
/* Set by lwIP's callbacks, acted on in the main loop. */
static int resolved;  /* 1 = server holds the address, -1 = the lookup failed */
static int connected; /* 1 = connected and the request is queued, -1 = the request could not be queued */
static int closed;    /* the server finished sending and closed */
static int broken;    /* the connection was refused, reset or timed out */
static char response[512];
static u32 received;

static void say(const char *a, const char *b) {
  bw_serial_write(a);
  bw_serial_write(b);
  bw_serial_write("\n");
}

static void fail(const char *what) __attribute__((noreturn));
static void fail(const char *what) {
  say("error: ", what);
  for (;;) {
  }
}

static void on_resolved(const char *name, const ip_addr_t *address, void *argument) {
  (void)name;
  (void)argument;
  if (address) {
    server = *address;
    resolved = 1;
  } else {
    resolved = -1;
  }
}

static err_t on_connected(void *argument, struct tcp_pcb *pcb, err_t error) {
  (void)argument;
  (void)error;
  if (tcp_write(pcb, REQUEST, sizeof REQUEST - 1, TCP_WRITE_FLAG_COPY) != ERR_OK || tcp_output(pcb) != ERR_OK) {
    connected = -1;
  } else {
    connected = 1;
  }
  return ERR_OK;
}

static err_t on_received(void *argument, struct tcp_pcb *pcb, struct pbuf *p, err_t error) {
  (void)argument;
  (void)error;
  if (!p) {
    /* The server has closed its side: close ours. */
    closed = 1;
    if (tcp_close(pcb) != ERR_OK) {
      tcp_abort(pcb);
      return ERR_ABRT;
    }
    return ERR_OK;
  }
  /* Keep the start of the response; what does not fit is acknowledged and dropped. */
  received += pbuf_copy_partial(p, response + received, (u16_t)(sizeof response - 1 - received), 0);
  tcp_recved(pcb, p->tot_len);
  pbuf_free(p);
  return ERR_OK;
}

static void on_broken(void *argument, err_t error) {
  (void)argument;
  (void)error;
  /* lwIP has already freed the connection. */
  broken = 1;
}

static void report_response(void) {
  response[received] = 0;
  if (strncmp(response, "HTTP/1.", 7) != 0) fail("http: the answer is not an HTTP response");
  char *body = strstr(response, "\r\n\r\n");
  if (!body) fail("http: the response headers do not end in the first 511 bytes");
  body += 4;
  char *end = body;
  while (*end && *end != '\r' && *end != '\n') end++;
  *end = 0;
  say("http ", body);
}

int main(void) {
  enum { ADDRESS, LOOKUP, CONNECT, EXCHANGE } step = ADDRESS;
  char text[IP4ADDR_STRLEN_MAX];
  bw_serial_begin(115200);
  bw_millis_begin();
  bw_interrupts_on();

  int joined = bw_net_join("bw-world", "brickwright");
  if (joined != BW_NET_JOINED) {
    fail(joined == BW_NET_WRONG_PASSWORD ? "join: wrong password"
         : joined == BW_NET_NO_NETWORK ? "join: no such network"
         : "join: no network device");
  }

  lwip_init();
  if (!netif_add(&netif, 0, 0, 0, 0, bwnetif_init, ethernet_input)) fail("netif: the interface could not be added");
  netif_set_default(&netif);
  netif_set_up(&netif);
  netif_set_link_up(&netif);
  if (dhcp_start(&netif) != ERR_OK) fail("dhcp: the client could not start");

  u32 since = bw_millis();
  for (;;) {
    bwnetif_poll(&netif);
    sys_check_timeouts();
    u32 waited = bw_millis() - since;
    if (step == ADDRESS) {
      if (dhcp_supplied_address(&netif)) {
        say("ip ", ip4addr_ntoa_r(netif_ip4_addr(&netif), text, sizeof text));
        err_t e = dns_gethostbyname(HOST, &server, on_resolved, 0);
        if (e == ERR_OK) resolved = 1;
        else if (e != ERR_INPROGRESS) fail("dns: the query could not be sent");
        step = LOOKUP;
        since = bw_millis();
      } else if (waited > 10000) {
        fail("dhcp: no address after 10 s");
      }
    } else if (step == LOOKUP) {
      if (resolved > 0) {
        say("dns " HOST " -> ", ip4addr_ntoa_r(&server, text, sizeof text));
        struct tcp_pcb *pcb = tcp_new();
        if (!pcb) fail("tcp: no memory for a connection");
        tcp_err(pcb, on_broken);
        tcp_recv(pcb, on_received);
        if (tcp_connect(pcb, &server, 80, on_connected) != ERR_OK) fail("tcp: the connection could not be started");
        step = CONNECT;
        since = bw_millis();
      } else if (resolved < 0) {
        fail("dns: the server has no address for " HOST);
      } else if (waited > 15000) {
        fail("dns: no answer after 15 s");
      }
    } else if (step == CONNECT) {
      if (broken) fail("tcp: the connection was refused or timed out");
      if (connected < 0) fail("http: the request could not be queued");
      if (connected > 0) {
        step = EXCHANGE;
        since = bw_millis();
      } else if (waited > 10000) {
        fail("tcp: no connection after 10 s");
      }
    } else {
      if (closed) {
        report_response();
        break;
      }
      if (broken) fail("http: the connection was reset before the response ended");
      if (waited > 10000) fail("http: the response did not end within 10 s");
    }
  }
  bw_serial_write("done\n");
  /* Keep the stack running: the closing handshake is still in flight. */
  for (;;) {
    bwnetif_poll(&netif);
    sys_check_timeouts();
  }
}
