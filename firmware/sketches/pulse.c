/* Measure pulses on GPIO5 with pulseIn and report each length, rounded to 100 microseconds. */
#include <Arduino.h>

static void number(unsigned long value) {
  char text[12];
  int at = 11;
  text[at] = 0;
  do { text[--at] = (char)('0' + value % 10); value /= 10; } while (value);
  bw_serial_write(text + at);
}

void setup(void) {
  bw_serial_begin(115200);
  pinMode(5, INPUT);
  bw_serial_write("ready\n");
}

void loop(void) {
  unsigned long width = pulseIn(5, HIGH, 200000);
  if (!width) return;
  bw_serial_write("pulse ");
  number((width + 50) / 100 * 100);
  bw_serial_write("\n");
}
