/*
 * Link a blob-free ESP8266 program to run from RAM.
 *
 * Code goes to instruction RAM, data to data RAM; nothing is mapped from
 * flash, so the image's segments are the whole program and the ROM (or this
 * simulator's loader) only has to copy them and jump to bw_start.
 */
MEMORY
{
  dram : org = 0x3FFE8000, len = 0x14000
  iram : org = 0x40100000, len = 0x8000
}

ENTRY(bw_start)

SECTIONS
{
  .text :
  {
    *(.entry.text)
    *(.literal .literal.* .text .text.*)
  } > iram

  .data :
  {
    *(.rodata .rodata.* .data .data.*)
  } > dram

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _bss_start = .;
    *(.bss .bss.* COMMON)
    . = ALIGN(4);
    _bss_end = .;
  } > dram
}

INCLUDE rom.ld
