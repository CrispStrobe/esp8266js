/* Blink the LED on GPIO2 every 500 ms and say so on the serial port. */
#include "bw8266.h"

#define LED (1u << 2)

int main(void) {
  bw_serial_begin(115200);
  IOMUX_GPIO2 &= ~0x130u;
  GPIO_ENABLE_W1TS = LED;
  bw_millis_begin();
  bw_interrupts_on();
  bw_serial_write("blink\n");
  u32 last = 0;
  int on = 0;
  for (;;) {
    if (bw_millis() - last < 500) continue;
    last += 500;
    on = !on;
    if (on) {
      GPIO_OUT_W1TS = LED;
      bw_serial_write("on\n");
    } else {
      GPIO_OUT_W1TC = LED;
      bw_serial_write("off\n");
    }
  }
}
