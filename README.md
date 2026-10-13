# esp8266js

ESP8266 Simulator in JavaScript from Wokwi

## About this fork

This is a fork of [wokwi/esp8266js](https://github.com/wokwi/esp8266js), kept
under the same MIT licence. It differs in one deliberate way so far:

- **No mask ROM.** Upstream's tree carries `rom/esp8266_rom.bin`, Espressif's
  64 KB mask ROM. That image is Espressif's and is not covered by this
  project's MIT licence, so it is removed here and nothing in this fork's CI
  runs it. The CLI takes `--rom <file>` for an image you supply yourself.
  (The file is still reachable in the upstream history this fork shares.)

`src/rom/` holds the stand-ins written so far (`RomHle`): the C library
memory and string functions and libgcc's integer and soft-float arithmetic,
41 of the 97 ROM entries stock Arduino sketches link against. A ROM entry with
no stand-in stops the run and names the function. Not provided yet: the task
scheduler and interrupt entry, UART and printf, SPI flash, and everything
radio.

`firmware/` is a small bare-metal runtime of our own (start-up, serial
output, a millisecond clock, pins) and a blink program built on it. It
contains no Espressif SDK code and links against nothing but itself and the
compiler's libgcc (and, for `net-ip` below, lwIP); CI checks the link map for
that, builds the image with `tools/elf2image.js` and runs it here without the
ROM. Small programs run entirely from RAM. Larger ones also run in place from
flash: the linker script (`firmware/bw8266.ld`) has a region for code at flash
offset 0x10000, mapped at 0x40210000 once start-up has asked the ROM for the
mapping, and the image tool writes it there behind the boot image. Stock Arduino images
are a different matter: they always carry Espressif's SDK libraries, whose
licence limits their use to the ESP8266 itself, and this repository's CI does
not run them.

### A simulated Wi-Fi world

The chip's own Wi-Fi lives in Espressif's radio libraries and is not
simulated. Instead there is a simulated network (`src/net/world.ts`): access
points with a name and a password, and members that exchange Ethernet frames
through them. Members are boards, through a network device that exists only
in this simulator (`src/peripherals/bwnet.ts`, at 0x60000C00, register map in
the file), and host-side stations a test or an application adds, which is how
anything that is not a board takes part. `firmware/net.c` is the firmware
side; `firmware/net-hello.c` joins a network, greets everyone on it and prints
what it hears.

Membership and delivery are modelled. Radio behaviour is not: no range, loss,
channels, timing or encryption.

### TCP/IP: lwIP on the firmware side

`firmware/lwip-port/` is a port of [lwIP](https://savannah.nongnu.org/projects/lwip/)
2.2.0 to that runtime and that network device: no operating system
(`NO_SYS`), lwIP's raw callback API, IPv4 with ARP, ICMP, UDP, TCP, a DHCP
client and a DNS client. lwIP is BSD-licensed and is not kept in this
repository: CI fetches it at a pinned commit (`firmware/THIRD-PARTY.md`). No
C library is linked; the handful of memory and string functions lwIP calls
are the chip's ROM entries, which have stand-ins here.

`firmware/net-ip.c` uses it: it joins the network, gets an address by DHCP,
resolves `museum.lan` by DNS, fetches `http://museum.lan/hall` over TCP and
prints one line per step. `test/own-ip.test.js` runs the built image against
the other end of that exchange.

Sizes, as CI built them (xtensa-lx106-elf-gcc of the Arduino ESP8266 package
3.1.2, `-Os`):

| image | file | in RAM (boot image) | in flash |
|---|---|---|---|
| `blink` | 944 bytes | 944 bytes | none |
| `net-hello` | 1,264 bytes | 1,264 bytes | none |
| `net-ip` | 108,860 bytes | 880 bytes | 43,324 bytes at offset 0x10000 |

`net-ip`'s file is mostly the erased gap between the two. Of its code and
constants, 43.3 KB (lwIP, the port, the program) run from flash and 0.8 KB
from instruction RAM; it uses 39.6 KB of the 80 KB of data RAM for lwIP's
heap and packet pool and its own buffers.

What this is not:

- **The other end is test scaffolding.** There is no host-side IP stack in
  this repository. `test/helpers/ip-responder.js` answers exactly what
  `net-ip` asks (ARP, one DHCP lease, one DNS name, one HTTP request per TCP
  connection), with correct checksums and nothing more: no retransmission, no
  time-outs, no windows.
- **No TLS, no IPv6**, no sockets API (there are no threads to block), no IP
  fragmentation or reassembly, no multicast.
- **The driver is polled** from the program's main loop; the device's receive
  interrupt is not used. A program that stops calling `bwnetif_poll` and
  `sys_check_timeouts` stops the stack.
- **The DHCP client does not probe its address for a conflict** before using
  it (lwIP's ARP probing is switched off; with it, binding takes seconds).
- **Random numbers are not secret.** Transaction ids and port numbers come
  from a small generator seeded with the network address and the clock.
- **It has only run here.** The network device does not exist on a real
  chip, so neither does this interface; the flash-mapped layout follows the
  chip's documented mapping but has not been tried on hardware.

The goal is a ROM-free boot: our own stand-ins for the ROM functions that
firmware actually calls. `census/` and the `rom-census` workflow measure which
ones those are for stock Arduino sketches.

## Building the ESP8266 "Hello World" app

Install python3 and pip. On Ubuntu:

```
sudo apt install python3 python3-pip python-is-python3
```

Then clone the ESP8266_RTOS_SDK and build the "Hello World" app:

```
git clone https://github.com/espressif/ESP8266_RTOS_SDK
cd ESP8266_RTOS_SDK
./install.sh
. ./export.sh
cd examples/get-started/hello_world
make
export HELLO_WORLD_PATH=`pwd`
```

## Simulating the ESP8266 "Hello World" app

```
npm start -- --rom <your-rom.bin> 0x0 $HELLO_WORLD_PATH/build/bootloader/bootloader.bin 0x8000 $HELLO_WORLD_PATH/build/partitions_singleapp.bin 0x10000 $HELLO_WORLD_PATH/build/hello-world.bin
```

Enjoy!

## License

Released under the [MIT licence](./LICENSE). Copyright (c) 2022-2023, Uri Shaked.
