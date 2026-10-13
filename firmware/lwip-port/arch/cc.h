/*
 * What lwIP needs to know about the compiler and the platform.
 *
 * No C library is linked. The compiler's own freestanding headers (stdint.h,
 * stddef.h) are used; string.h and stdlib.h are the small ones in libc/,
 * whose functions are the chip's mask ROM entries (rom.ld) or libc.c.
 */
#ifndef BW_LWIP_ARCH_CC_H
#define BW_LWIP_ARCH_CC_H

#define LWIP_NO_INTTYPES_H 1
#define LWIP_NO_LIMITS_H 1
#define LWIP_NO_CTYPE_H 1
#define LWIP_NO_UNISTD_H 1

#ifndef INT_MAX
#define INT_MAX __INT_MAX__
#endif

/* printf formats lwIP's debug output would use. Debug output is off; they only have to exist. */
#define X8_F "02x"
#define U16_F "u"
#define S16_F "d"
#define X16_F "x"
#define U32_F "lu"
#define S32_F "ld"
#define X32_F "lx"
#define SZT_F "u"

/* The LX106 is little-endian. */
#ifndef LITTLE_ENDIAN
#define LITTLE_ENDIAN 1234
#endif
#ifndef BIG_ENDIAN
#define BIG_ENDIAN 4321
#endif
#ifndef BYTE_ORDER
#define BYTE_ORDER LITTLE_ENDIAN
#endif

/* Protocol headers are laid out byte for byte, whatever their alignment in a frame. */
#define PACK_STRUCT_STRUCT __attribute__((packed))

/*
 * Diagnostics and failed assertions go to the serial port (sys_arch.c).
 * There is no printf: a diagnostic prints its format string as written,
 * without the values. An assertion prints its message and place, and stops.
 */
void bw_lwip_diag(const char *format, ...);
void bw_lwip_assert(const char *message, const char *file, int line) __attribute__((noreturn));
#define LWIP_PLATFORM_DIAG(x) do { bw_lwip_diag x; } while (0)
#define LWIP_PLATFORM_ASSERT(x) bw_lwip_assert(x, __FILE__, __LINE__)

/*
 * Random numbers for DHCP and DNS transaction ids and local port numbers.
 * A small generator seeded from the network address and the clock: it keeps
 * boards apart, and is predictable to anyone who wants to predict it.
 */
unsigned int bw_lwip_rand(void);
#define LWIP_RAND() ((u32_t)bw_lwip_rand())

#endif
