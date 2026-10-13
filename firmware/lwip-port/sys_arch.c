/* lwIP's platform functions without an operating system: the clock, random numbers, diagnostics. */
#include "lwip/opt.h"
#include "lwip/sys.h"
#include "bw8266.h"

/* Milliseconds since start-up, from the runtime's timer interrupt. Wraps after 49 days, which lwIP allows for. */
u32_t sys_now(void) { return bw_millis(); }

unsigned int bw_lwip_rand(void) {
  static u32 state;
  if (!state) {
    unsigned char mac[6];
    bw_net_mac(mac);
    for (int i = 0; i < 6; i++) state = state * 31u + mac[i];
    state ^= bw_millis() * 2654435761u;
    if (!state) state = 0x62773832u;
  }
  /* xorshift32 */
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

void bw_lwip_diag(const char *format, ...) { bw_serial_write(format); }

void bw_lwip_assert(const char *message, const char *file, int line) {
  char digits[12];
  int n = sizeof digits;
  digits[--n] = 0;
  do {
    digits[--n] = (char)('0' + line % 10);
    line /= 10;
  } while (line > 0 && n > 0);
  bw_serial_write("error: lwip assertion: ");
  bw_serial_write(message);
  bw_serial_write(" (");
  bw_serial_write(file);
  bw_serial_write(":");
  bw_serial_write(digits + n);
  bw_serial_write(")\n");
  for (;;) {
  }
}
