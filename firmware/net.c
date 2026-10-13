/* The simulator's network device: join a network, send and receive frames. See bw8266.h. */
#include "bw8266.h"

#define NET_ID REG(0x60000C00)
#define NET_CTRL REG(0x60000C04)
#define NET_STATUS REG(0x60000C08)
#define NET_MAC_LO REG(0x60000C0C)
#define NET_MAC_HI REG(0x60000C10)
#define NET_RX_LENGTH REG(0x60000C14)
#define NET_RX_DATA REG(0x60000C18)
#define NET_RX_DONE REG(0x60000C1C)
#define NET_TX_DATA REG(0x60000C20)
#define NET_TX_SEND REG(0x60000C24)
#define NET_SSID REG(0x60000C28)
#define NET_PASSWORD REG(0x60000C2C)

int bw_net_present(void) { return NET_ID == 0x62776e31u; }

int bw_net_join(const char *ssid, const char *password) {
  if (!bw_net_present()) return BW_NET_NO_DEVICE;
  NET_CTRL = 0;
  NET_SSID = 0;
  NET_PASSWORD = 0;
  for (; *ssid; ssid++) NET_SSID = (u32)(unsigned char)*ssid;
  for (; *password; password++) NET_PASSWORD = (u32)(unsigned char)*password;
  NET_CTRL = 1;
  u32 status = NET_STATUS;
  if (status & 1u) return BW_NET_JOINED;
  return (status & 8u) ? BW_NET_WRONG_PASSWORD : BW_NET_NO_NETWORK;
}

void bw_net_mac(unsigned char mac[6]) {
  u32 lo = NET_MAC_LO, hi = NET_MAC_HI;
  for (int i = 0; i < 4; i++) mac[i] = (unsigned char)(lo >> (8 * i));
  mac[4] = (unsigned char)hi;
  mac[5] = (unsigned char)(hi >> 8);
}

void bw_net_send(const unsigned char *frame, u32 length) {
  for (u32 i = 0; i < length; i += 4) {
    u32 word = 0;
    for (u32 j = 0; j < 4 && i + j < length; j++) word |= (u32)frame[i + j] << (8 * j);
    NET_TX_DATA = word;
  }
  NET_TX_SEND = length;
}

u32 bw_net_receive(unsigned char *frame, u32 room) {
  u32 length = NET_RX_LENGTH;
  if (!length) return 0;
  for (u32 i = 0; i < length && i < room; i += 4) {
    u32 word = NET_RX_DATA;
    for (u32 j = 0; j < 4 && i + j < length && i + j < room; j++) frame[i + j] = (unsigned char)(word >> (8 * j));
  }
  NET_RX_DONE = 1;
  return length;
}
