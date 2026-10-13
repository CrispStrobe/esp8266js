/* C library functions lwIP uses that the mask ROM does not have. */
#include <stdlib.h>

int atoi(const char *text) {
  int value = 0, negative = 0;
  while (*text == ' ' || (*text >= '\t' && *text <= '\r')) text++;
  if (*text == '-' || *text == '+') negative = *text++ == '-';
  for (; *text >= '0' && *text <= '9'; text++) value = value * 10 + (*text - '0');
  return negative ? -value : value;
}
