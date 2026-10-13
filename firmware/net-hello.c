/*
 * Join the network "bw-world", say hello to everyone on it every 200 ms, and
 * print what arrives. Messages are text in frames of type 0x88B5 (an
 * EtherType reserved for local experiments).
 */
#include "bw8266.h"

static const char HEX[] = "0123456789abcdef";
static unsigned char mac[6];
static unsigned char frame[128];

static void say(const char *text) {
  u32 n = 14;
  for (int i = 0; i < 6; i++) frame[i] = 0xff;
  for (int i = 0; i < 6; i++) frame[6 + i] = mac[i];
  frame[12] = 0x88;
  frame[13] = 0xb5;
  for (; *text && n < sizeof frame - 3; text++) frame[n++] = (unsigned char)*text;
  frame[n++] = (unsigned char)HEX[mac[5] >> 4];
  frame[n++] = (unsigned char)HEX[mac[5] & 15];
  bw_net_send(frame, n);
}

int main(void) {
  static unsigned char in[128];
  bw_serial_begin(115200);
  bw_millis_begin();
  bw_interrupts_on();
  int joined = bw_net_join("bw-world", "brickwright");
  if (joined != BW_NET_JOINED) {
    bw_serial_write(joined == BW_NET_WRONG_PASSWORD ? "join refused: wrong password\n"
                    : joined == BW_NET_NO_NETWORK ? "join refused: no such network\n"
                    : "no network device\n");
    for (;;) {
    }
  }
  bw_net_mac(mac);
  bw_serial_write("joined\n");
  u32 last = 0;
  for (;;) {
    u32 length = bw_net_receive(in, sizeof in - 1);
    if (length > 14 && in[12] == 0x88 && in[13] == 0xb5) {
      if (length > sizeof in - 1) length = sizeof in - 1;
      in[length] = 0;
      bw_serial_write("rx ");
      bw_serial_write((const char *)in + 14);
      bw_serial_write("\n");
    }
    if (bw_millis() - last >= 200) {
      last += 200;
      say("hello from ");
    }
  }
}
