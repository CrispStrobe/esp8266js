/* The Arduino-style layer. See Arduino.h for what is and is not provided. */
#include "Arduino.h"

#define GPIO_STATUS REG(0x6000031C)
#define GPIO_STATUS_W1TC REG(0x60000324)
#define GPIO_PIN(n) REG(0x60000328 + 4 * (n))
#define GPIO_ENABLE_W1TC REG(0x60000314)
#define GPIO_INTERRUPT 4
#define PIN_INT_TYPE_SHIFT 7
#define MUX_PULLUP (1u << 7)

/*
 * The pin function register of each GPIO, as an offset from 0x60000800, and
 * the function number that selects "GPIO" there; 0 offset = not usable.
 */
static const unsigned char MUX_OFFSET[16] = {0x34, 0x18, 0x38, 0x14, 0x3c, 0x40, 0, 0, 0, 0, 0, 0, 0x04, 0x08, 0x0c, 0x10};
static const unsigned char MUX_GPIO_FUNCTION[16] = {0, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3};

static void (*routines[16])(void);

static int usable(int pin) { return pin >= 0 && pin < 16 && MUX_OFFSET[pin] != 0; }

void pinMode(int pin, int mode) {
  if (!usable(pin)) return;
  volatile u32 *mux = (volatile u32 *)(0x60000800u + MUX_OFFSET[pin]);
  u32 function = MUX_GPIO_FUNCTION[pin];
  /* The function number sits in bits 4, 5 and 8; bit 7 is the pull-up. */
  u32 value = *mux & ~(0x130u | MUX_PULLUP);
  value |= ((function & 3u) << 4) | ((function & 4u) << 6);
  if (mode == INPUT_PULLUP) value |= MUX_PULLUP;
  *mux = value;
  if (mode == OUTPUT) GPIO_ENABLE_W1TS = 1u << pin;
  else GPIO_ENABLE_W1TC = 1u << pin;
}

void digitalWrite(int pin, int value) {
  if (!usable(pin)) return;
  if (value) GPIO_OUT_W1TS = 1u << pin;
  else GPIO_OUT_W1TC = 1u << pin;
}

int digitalRead(int pin) {
  if (!usable(pin)) return 0;
  return (GPIO_IN >> pin) & 1u;
}

unsigned long millis(void) { return bw_millis(); }

/* The second hardware timer counts at 5 MHz once bw_millis_begin has started it. */
unsigned long micros(void) { return FRC2_COUNT / 5u; }

void delay(unsigned long milliseconds) {
  unsigned long start = bw_millis();
  while (bw_millis() - start < milliseconds) {
  }
}

void delayMicroseconds(unsigned int microseconds) { ets_delay_us(microseconds); }

static void pin_interrupt(void *unused) {
  (void)unused;
  u32 pending = GPIO_STATUS;
  GPIO_STATUS_W1TC = pending;
  for (int pin = 0; pin < 16; pin++) {
    if ((pending & (1u << pin)) && routines[pin]) routines[pin]();
  }
}

void attachInterrupt(int pin, void (*routine)(void), int mode) {
  static int attached;
  if (!usable(pin) || mode < RISING || mode > CHANGE) return;
  routines[pin] = routine;
  if (!attached) {
    attached = 1;
    ets_isr_attach(GPIO_INTERRUPT, pin_interrupt, 0);
    ets_isr_unmask(1u << GPIO_INTERRUPT);
  }
  GPIO_STATUS_W1TC = 1u << pin;
  GPIO_PIN(pin) = (GPIO_PIN(pin) & ~(7u << PIN_INT_TYPE_SHIFT)) | ((u32)mode << PIN_INT_TYPE_SHIFT);
}

void detachInterrupt(int pin) {
  if (!usable(pin)) return;
  GPIO_PIN(pin) = GPIO_PIN(pin) & ~(7u << PIN_INT_TYPE_SHIFT);
  routines[pin] = 0;
}

void shiftOut(int dataPin, int clockPin, int bitOrder, unsigned char value) {
  for (int i = 0; i < 8; i++) {
    int bit = bitOrder == LSBFIRST ? i : 7 - i;
    digitalWrite(dataPin, (value >> bit) & 1);
    digitalWrite(clockPin, HIGH);
    digitalWrite(clockPin, LOW);
  }
}

unsigned long pulseIn(int pin, int state, unsigned long timeoutMicroseconds) {
  unsigned long start = micros();
  /* Let a pulse already under way end, wait for the next to begin, then time it. */
  while (digitalRead(pin) == state) if (micros() - start >= timeoutMicroseconds) return 0;
  while (digitalRead(pin) != state) if (micros() - start >= timeoutMicroseconds) return 0;
  unsigned long began = micros();
  while (digitalRead(pin) == state) if (micros() - start >= timeoutMicroseconds) return 0;
  return micros() - began;
}

int main(void) {
  bw_millis_begin();
  bw_interrupts_on();
  setup();
  for (;;) loop();
}
