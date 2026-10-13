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
compiler's libgcc; CI checks the link map for that, builds the image with
`tools/elf2image.js` and runs it here without the ROM. Stock Arduino images
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
channels, timing or encryption. No TCP/IP stack runs on it yet; the device is
frame-level so that one can.

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
