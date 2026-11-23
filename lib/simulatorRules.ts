/**
 * Help text shown in the "Rules" drawer of the simulator.
 *
 * Plain data only: edit the wording here without touching the simulator.
 * Text between backticks (`like this`) is shown in code style.
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

export const SIMULATOR_RULES_TITLE = "Open8085 Lab: rules for using the simulator";

export const SIMULATOR_RULES: readonly SimulatorRuleSection[] = [
  {
    title: "Writing the program",
    rules: [
      {
        text: "Clear the editor before you start: click in it, press Ctrl+A, then Delete.",
      },
      {
        text: "The program is placed at 2000H automatically, so no `ORG` line is needed for the code.",
      },
      {
        text: "End every hexadecimal number with H, for example `2500H` and `25H`. A number without H is read as decimal, with no error: `LXI H,2500` loads 09C4H, not 2500H.",
      },
      {
        text: "If a hexadecimal number starts with a letter (A–F), put a 0 in front: `0CDH`, `0FFH`, `0C050H`. Writing `CDH` gives an \"Undefined symbol\" error.",
      },
      {
        text: "Write a label as a name followed by a colon (`LOOP:`), starting with a letter. Comments start with `;`. Upper or lower case both work.",
      },
      {
        text: "End the program with `HLT`. Without it the simulator keeps running.",
      },
      {
        text: "If you use `PUSH`, `POP`, `CALL` or `RET`, first set the stack pointer to an address away from your program and data, for example `LXI SP,27FFH`.",
      },
      {
        text: "Keep your data well away from 2000H. A long program can run past a data area placed just after it, such as 2050H, and your typed data would then overwrite your own code.",
      },
      {
        text: "Don't write your program inside a solved example from the Examples list. Assembling a solved example also loads that example's own data into 2500H–2505H.",
      },
    ],
  },
  {
    title: "Entering data in memory",
    rules: [
      {
        text: "Memory is empty (00H) when you start, and every Assemble clears it. So assemble first, then enter the data.",
      },
      {
        text: "To enter data: type the address in the Memory address box (no H, for example `2500`) and press Go. Click a byte, type two hex digits (no H, for example `CD`), and press Enter. Do this for each byte; Tab does not move to the next byte.",
      },
      {
        text: "The Memory panel shows 32 bytes starting from the address you enter. Use Go again to see another area.",
      },
      {
        text: "Any change to the program, even a comment, makes Run and Step assemble again, and that erases the data you typed. After every edit: Assemble, enter the data again, then Run.",
      },
      {
        text: "Instead of typing the data each time, you can write it at the end of the program, after `HLT`, using `ORG` and `DB`. It is then loaded on every Assemble, and the program still starts at 2000H:",
        code: "HLT\nORG 2500H\nDB 05H, 0CDH, 22H",
      },
    ],
  },
  {
    title: "Running and checking",
    rules: [
      {
        text: "Shortcuts: Ctrl+Enter assembles, F8 runs or pauses, F10 executes one instruction, and Shift+F5 resets.",
      },
      {
        text: "The speed starts at 10 instructions per second. Select 1000 before Run for programs with loops, or use Step (F10) to go one instruction at a time.",
      },
      {
        text: "After `HLT`, press Reset before running again. Reset keeps the program and the memory, so to try new data just change the data bytes, press Reset, then Run.",
      },
      {
        text: "Results from the previous run stay in memory. Set the result bytes back to 00 before a new run so an old answer is not mistaken for a new one.",
      },
      {
        text: "Click a line number in the editor to set a breakpoint; Run pauses before that line.",
      },
      {
        text: "Use Export to save your program as an .asm file.",
      },
    ],
  },
];
