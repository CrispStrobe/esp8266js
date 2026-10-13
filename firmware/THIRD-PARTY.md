# Third-party code used by the firmware

Nothing listed here is kept in this repository. It is fetched when the
firmware is built (`.github/workflows/ci.yml`, job `own-firmware`), at a
pinned commit that the workflow checks after the checkout.

## lwIP

The TCP/IP stack that `net-ip` is linked with.

- Project: lwIP, "A Lightweight TCP/IP stack", <https://savannah.nongnu.org/projects/lwip/>
- Fetched from its official mirror: <https://github.com/lwip-tcpip/lwip>
- Release: 2.2.0, tag `STABLE-2_2_0_RELEASE`
- Commit: `0a0452b2c39bdd91e252aef045c115f88f6ca773`
- Used: `src/core/*.c`, `src/core/ipv4/*.c`, `src/netif/ethernet.c` and
  `src/include/`, unmodified. The configuration and the platform layer are
  ours, in `firmware/lwip-port/`.
- Licence: BSD 3-Clause ("modified BSD"), the file `COPYING` of the lwIP
  tree. Its text:

```
Copyright (c) 2001, 2002 Swedish Institute of Computer Science.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
OF SUCH DAMAGE.
```

A built `net-ip` image contains lwIP in binary form: whoever passes such an
image on has to pass this notice on with it (condition 2). CI puts a copy of
this file next to the images in the workflow artifact it uploads.

## The compiler

`xtensa-lx106-elf-gcc` and its `libgcc` come from the Arduino ESP8266 package
(GCC, GPL-3.0 with the GCC Runtime Library Exception for `libgcc`). Nothing
else of that package is compiled, linked or run: no SDK library, no Arduino
core, no C library and none of its headers, and not the copy of lwIP it
carries. CI checks the link map for that.
