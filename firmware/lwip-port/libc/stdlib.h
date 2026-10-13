/* The one stdlib function lwIP uses with this configuration. It is in libc.c: the ROM has none. */
#ifndef BW_LIBC_STDLIB_H
#define BW_LIBC_STDLIB_H
#include <stddef.h>

int atoi(const char *text);

#endif
