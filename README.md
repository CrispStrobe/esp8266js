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
