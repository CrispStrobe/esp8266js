/*
 * The memory and string functions lwIP uses. No C library is linked: these
 * resolve to the chip's mask ROM entries of the same names (rom.ld).
 */
#ifndef BW_LIBC_STRING_H
#define BW_LIBC_STRING_H
#include <stddef.h>

void *memcpy(void *dest, const void *src, size_t n);
void *memmove(void *dest, const void *src, size_t n);
void *memset(void *dest, int c, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t n);
char *strstr(const char *haystack, const char *needle);

#endif
