#!/usr/bin/env bash
# List the mask-ROM symbols a linked ESP8266 ELF refers to.
#
# The Arduino core's linker script gives every ROM entry point as
# PROVIDE(name = 0x4000xxxx). A PROVIDEd symbol exists in the output only if
# something referenced it, so the symbols of a linked ELF that sit in the ROM
# window (0x40000000-0x4000ffff) are the ROM functions and tables that image
# uses. This reads names and addresses only; it does not read any ROM image.
#
#   census/rom-symbols.sh <xtensa-lx106-elf-nm> <firmware.elf>
set -euo pipefail
nm="$1"; elf="$2"
"$nm" "$elf" | awk '
  { addr = strtonum("0x" $1) }
  addr >= 0x40000000 && addr <= 0x4000ffff { printf "%s %s %s\n", $1, $2, $3 }
' | sort
