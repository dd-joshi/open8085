/**
 * Help text shown in the Help drawer of the simulator.
 *
 * Plain data only: edit the wording here without touching the simulator.
 * Text between backticks (`like this`) is shown in code style.
 * Keep the language simple: short sentences, one idea per rule.
 */

export interface SimulatorRule {
  readonly text: string;
  /** Optional multi-line code example shown under the rule. */
  readonly code?: string;
}

export interface SimulatorRuleSection {
  readonly title: string;
  readonly rules: readonly SimulatorRule[];
}

export const SIMULATOR_RULES_TITLE = "Open8085 Lab: how to use the simulator";

export const SIMULATOR_RULES: readonly SimulatorRuleSection[] = [
  {
    title: "Writing your program",
    rules: [
      {
        text: "To start fresh, click in the editor, press Ctrl+A, then Delete.",
      },
      {
        text: "Your program starts at 2000H by itself. You do not need an `ORG` line for it.",
      },
      {
        text: "Put H at the end of every hex number: `2500H`, `25H`. A number without H is decimal, and you get no error: `LXI H,2500` loads 09C4H, not 2500H.",
      },
      {
        text: "If a hex number starts with a letter (A to F), put a 0 in front: `0CDH`, `0FFH`, `0C050H`. Writing `CDH` gives an \"Undefined symbol\" error.",
      },
      {
        text: "A label is a name with a colon, like `LOOP:`. It must start with a letter. A comment starts with `;`. Capital and small letters both work.",
      },
      {
        text: "You can give a number a name with `EQU` and then use the name. This is handy for port addresses:",
        code: "PPI EQU 80H      ; 8255 base port\nOUT PPI+3        ; same as OUT 83H",
      },
      {
        text: "End your program with `HLT`. Without it, the program never stops.",
      },
      {
        text: "Using `PUSH`, `POP`, `CALL` or `RET`? First set the stack pointer away from your program and data, for example `LXI SP,27FFH`.",
      },
      {
        text: "Keep your data far from 2000H, for example at 2500H. If data sits just after the program (like 2050H), a long program can run into it and your data overwrites your code.",
      },
      {
        text: "Don't type your own program over a solved example. When you assemble an example, it also loads that example's own data (from 2500H).",
      },
    ],
  },
  {
    title: "Putting data in memory",
    rules: [
      {
        text: "Memory starts empty (all 00H), and every Assemble clears it. So: Assemble first, then type your data.",
      },
      {
        text: "To type data: enter the address in the Memory box without H (for example `2500`) and press Go. Click a byte, type two hex digits without H (for example `CD`) and press Enter. Repeat for each byte. Tab does not jump to the next byte.",
      },
      {
        text: "The Memory panel shows 32 bytes from the address you choose. Press Go with another address to see another area.",
      },
      {
        text: "Any change to the program, even a comment, means Run or Step will assemble again, and that clears your data. So after every edit: Assemble, type the data again, then Run.",
      },
      {
        text: "Tip: put your data at the end of the program, after `HLT`, using `ORG` and `DB`. Then it loads by itself on every Assemble, and the program still starts at 2000H:",
        code: "HLT\nORG 2500H\nDB 05H, 0CDH, 22H",
      },
    ],
  },
  {
    title: "Running and checking",
    rules: [
      {
        text: "Keys: Ctrl+Enter = Assemble, F8 = Run or Pause, F10 = run one instruction (Step), Shift+F5 = Reset.",
      },
      {
        text: "Speed starts at 10 instructions per second. For programs with loops, choose 1000 before Run. Or press Step (F10) to go one instruction at a time.",
      },
      {
        text: "After `HLT`, press Reset before you run again. Reset keeps your program and memory. To try new data: change the data bytes, press Reset, then Run.",
      },
      {
        text: "Old results stay in memory. Set the result bytes back to 00 before a new run, so you don't mistake an old answer for a new one.",
      },
      {
        text: "Click a line number to set a breakpoint. Run stops just before that line.",
      },
      {
        text: "Export saves your program as an .asm file on your computer.",
      },
    ],
  },
  {
    title: "Virtual I/O board (ports 01H and 02H)",
    rules: [
      {
        text: "`OUT 01H` shows the A register on the 8 LEDs (D7 to D0). A lit LED means that bit is 1.",
      },
      {
        text: "`IN 02H` reads the 8 switches into A. Click a switch to turn it on (1) or off (0).",
      },
      {
        text: "This board is always there. The 8255 and 8155 cannot use ports 01H or 02H.",
      },
    ],
  },
  {
    title: "8255 and 8155 chips: getting started",
    rules: [
      {
        text: "In the bar at the top, set Virtual 8255 / 8155 to On to show the I/O chips column. Set it to Off to hide it again. The two chip examples in the Examples list switch it on for you.",
      },
      {
        text: "Each chip has a base address (shown in its base box). Its ports follow one after another. With the starting addresses:",
        code: "8255 at 80H:  PA 80H   PB 81H   PC 82H   control 83H\n8155 at 20H:  command/status 20H   PA 21H   PB 22H\n              PC 23H   timer low 24H   timer high 25H\n8155 RAM:     2800H to 28FFH",
      },
      {
        text: "The white tag at the start of each line (like `80H`) is the port number to use with `IN` and `OUT`.",
      },
      {
        text: "Output ports show LEDs. Input ports show switches: click a switch to change that bit. The value on the right of each line is what `IN` from that port would give right now.",
      },
      {
        text: "The line \"last:\" shows the most recent `IN` or `OUT` to that chip, for example `OUT 80H ← C1H` (C1H was sent to port 80H).",
      },
      {
        text: "Your kit uses other addresses? Pause the program, type the new base in the base box and press Enter. Use the same address in your program; with an `EQU` line at the top it is a one-line change. The 8255 base must be a multiple of 4 and the 8155 base a multiple of 8 (other values are rounded down). Two chips can never share a port.",
      },
      {
        text: "Assemble and Reset also reset both chips, like the RESET key on a kit: every port becomes an input and the timer stops.",
      },
    ],
  },
  {
    title: "Using the 8255",
    rules: [
      {
        text: "First send a control word to the control port (base + 3). Bit 7 = 1 means \"set the mode\". Bits 4, 1, 3 and 0 choose Port A, Port B, upper Port C and lower Port C: 1 makes it an input, 0 makes it an output. Keep bits 6, 5 and 2 at 0 for mode 0.",
        code: "MVI A,89H        ; 1000 1001: mode 0, A out, B out, C in\nOUT 83H",
      },
      {
        text: "The card explains the control word in words, for example \"Mode 0 · Port A out · Port B out · Port C in\".",
      },
      {
        text: "Sending a mode control word (bit 7 = 1) sets every output port back to 00H. So send it first, then write to the ports.",
      },
      {
        text: "A control word with bit 7 = 0 changes just one bit of Port C (bit set/reset). Bits 3 to 1 pick the bit (0 to 7) and bit 0 is the new value:",
        code: "MVI A,07H        ; 0000 0111: set PC3 to 1\nOUT 83H",
      },
      {
        text: "Only mode 0 (simple input and output) is simulated. Modes 1 and 2 need handshake signals (strobe and acknowledge) from a real device such as a printer. Here the ports then work like mode 0, and the card shows a warning.",
      },
    ],
  },
  {
    title: "Using the 8155 ports and timer",
    rules: [
      {
        text: "Send a command to the command port (base + 0) to set up the ports. Bit 0 = 1 makes Port A an output; bit 1 = 1 makes Port B an output. Bits 3–2 = 00 make Port C an input; 11 make it an output. Port C has only 6 bits (PC0 to PC5).",
      },
      {
        text: "`IN` from the same port (base + 0) reads the status. Bit 6 (TIMER) becomes 1 when the timer finishes a count. Reading the status sets it back to 0.",
      },
      {
        text: "To start the timer, load the count and mode, then send a command with bits 7–6 = 11:",
        code: "MVI A,0E8H       ; count low byte (count = 03E8H = 1000)\nOUT 24H\nMVI A,43H        ; 01 = repeating square wave, count high = 03H\nOUT 25H\nMVI A,0C1H       ; 11 = start timer, bit 0 = Port A out\nOUT 20H",
      },
      {
        text: "Timer modes (bits 7–6 of the timer high byte): 00 = one square wave, 01 = repeating square wave, 10 = one pulse, 11 = repeating pulse. The count must be 2 or more.",
      },
      {
        text: "Timer commands (bits 7–6 of the command): 00 = no change, 01 = stop now, 10 = stop when this count ends, 11 = start.",
      },
      {
        text: "The small screen (OLED) draws the timer output (TIMER OUT). Under it, f is the frequency, ON is the time the output is high, and OFF is the time it is low, as on a real kit where the timer clock is the 8085 clock output (3.072 MHz).",
      },
      {
        text: "In the simulator the timer counts the 8085 clock cycles while your program runs. When the program stops (HLT or Pause), the timer stops too. On a real kit the timer keeps running even after HLT.",
      },
      {
        text: "The 8155 RAM (2800H to 28FFH) is normal memory. Click View in memory to see it in the Memory panel.",
      },
      {
        text: "Port C handshake modes (command bits 3–2 = 01 or 10) are not simulated; the card shows a warning.",
      },
    ],
  },
];
