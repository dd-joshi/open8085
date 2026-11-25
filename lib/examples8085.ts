export type ExampleDifficulty = "Beginner" | "Intermediate";

export interface ExampleSetup {
  readonly memory: readonly string[];
  readonly ports: readonly string[];
}

export interface Example8085 {
  readonly id: string;
  readonly title: string;
  readonly difficulty: ExampleDifficulty;
  readonly learningGoal: string;
  readonly source: string;
  readonly setup: ExampleSetup;
  readonly expectedResult: string;
  readonly tips: readonly string[];
  /** Needs the virtual 8255/8155; choosing the example switches them on. */
  readonly usesChips?: boolean;
}

export interface InstructionCategory {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly mnemonics: readonly string[];
}

export const examples8085 = [
  {
    id: "add-two-8-bit",
    title: "Add two 8-bit numbers",
    difficulty: "Beginner",
    learningGoal:
      "Load two bytes from memory, add them, and preserve both the 8-bit sum and carry.",
    source: `; Add the bytes at 2500H and 2501H.
; Store the low byte at 2502H and carry at 2503H.
ORG 2000H

LDA 2500H
MOV B,A
LDA 2501H
ADD B
STA 2502H

MVI A,00H
ACI 00H
STA 2503H
HLT`,
    setup: {
      memory: [
        "2500H = F2H (first number)",
        "2501H = 35H (second number)",
      ],
      ports: ["No I/O port setup is required."],
    },
    expectedResult:
      "2502H = 27H and 2503H = 01H, representing the 16-bit answer 0127H.",
    tips: [
      "ADD leaves the low eight bits in A and records overflow in CY.",
      "MVI does not change the flags, so ACI 00H converts CY into 00H or 01H.",
      "Try values whose sum is below FFH and observe that 2503H becomes 00H.",
    ],
  },
  {
    id: "sum-array-16-bit",
    title: "Sum an array into a 16-bit result",
    difficulty: "Intermediate",
    learningGoal:
      "Walk through an array with HL and extend each 8-bit addition into a 16-bit total.",
    source: `; 2500H holds the element count.
; The array begins at 2501H.
; Store the result as low byte, then high byte.
ORG 2000H

LDA 2500H
MOV E,A
MVI B,00H
MVI C,00H
ORA A
JZ STORE

LXI H,2501H
SUMLOOP: MOV A,C
ADD M
MOV C,A
JNC NOCARRY
INR B
NOCARRY: INX H
DCR E
JNZ SUMLOOP

STORE: MOV A,C
STA 2600H
MOV A,B
STA 2601H
HLT`,
    setup: {
      memory: [
        "2500H = 05H (five elements)",
        "2501H..2505H = 80H, 90H, A0H, B0H, C0H",
      ],
      ports: ["No I/O port setup is required."],
    },
    expectedResult:
      "2600H = E0H and 2601H = 02H, so the 16-bit sum is 02E0H.",
    tips: [
      "HL is the array pointer; M means the byte currently addressed by HL.",
      "C holds the low byte and B holds the high byte of the running sum.",
      "JNC skips the high-byte increment when the low-byte addition has no carry.",
    ],
  },
  {
    id: "block-copy",
    title: "Copy a block of memory",
    difficulty: "Beginner",
    learningGoal:
      "Use two register-pair pointers to copy a variable-length block without changing its bytes.",
    source: `; 2500H holds the byte count.
; Copy from 2501H onward to 2600H onward.
ORG 2000H

LDA 2500H
MOV B,A
ORA A
JZ FINISH

LXI H,2501H
LXI D,2600H
COPY: MOV A,M
STAX D
INX H
INX D
DCR B
JNZ COPY

FINISH: HLT`,
    setup: {
      memory: [
        "2500H = 05H (five bytes)",
        "2501H..2505H = 11H, 22H, 33H, 44H, 55H",
        "2600H..2604H may contain any values before execution.",
      ],
      ports: ["No I/O port setup is required."],
    },
    expectedResult:
      "2600H..2604H contain 11H, 22H, 33H, 44H, 55H in the same order.",
    tips: [
      "HL points to the source and DE points to the destination.",
      "STAX D stores A at the address held by DE.",
      "The zero-count check avoids copying 256 bytes by mistake.",
    ],
  },
  {
    id: "bcd-led-counter",
    title: "BCD up-counter on an output port",
    difficulty: "Intermediate",
    learningGoal:
      "Generate decimal counts from 00 to 99 in packed BCD and send each value to an LED port.",
    source: `; Send packed-BCD values 00 through 99 to port 01H.
ORG 2000H

LXI SP,3FFFH
MVI B,64H
XRA A

COUNT: OUT 01H
CALL DELAY
ADI 01H
DAA
DCR B
JNZ COUNT
HLT

DELAY: MVI D,0AH
DLOOP1: MVI E,7FH
DLOOP2: DCR E
JNZ DLOOP2
DCR D
JNZ DLOOP1
RET`,
    setup: {
      memory: ["No data-memory setup is required."],
      ports: [
        "No setup is required; watch port 01H on the built-in Virtual I/O board.",
      ],
    },
    expectedResult:
      "Port 01H receives 00H, 01H, ... 09H, 10H, ... 99H; its final latched value is 99H.",
    tips: [
      "DAA adjusts the binary addition result into valid packed BCD.",
      "64H is 100 decimal, so B limits the example to exactly one 00-to-99 cycle.",
      "CALL needs a valid stack, which is why SP is initialized before the loop.",
      "At the maximum 1000 instructions per second, each value remains visible for about 2.6 seconds.",
      "Physical hardware needs larger delay constants because its clock runs much faster than this simulator.",
    ],
  },
  {
    id: "ppi-8255-running-light",
    title: "8255 PPI: running light and switches",
    difficulty: "Intermediate",
    learningGoal:
      "Program the 8255 in mode 0, drive LEDs on Port A and read switches on Port C.",
    source: `; 8255 PPI: running light on Port A, Port C switches copied to Port B.
; Choosing this example switches on 8255 / 8155: Virtual.
; Different kit address? Change PPI here and the 8255 base on its card.
PPI EQU 80H       ; 8255 base port
PORTA EQU PPI     ; Port A    80H
PORTB EQU PPI+1   ; Port B    81H
PORTC EQU PPI+2   ; Port C    82H
CWR EQU PPI+3     ; control   83H

ORG 2000H
LXI SP,3FFFH
MVI A,89H         ; control word 1000 1001: mode 0, A out, B out, C in
OUT CWR
MVI B,01H         ; one lit LED

LOOP: MOV A,B
OUT PORTA         ; running light on the Port A LEDs
IN PORTC          ; read the Port C switches
OUT PORTB         ; copy them to the Port B LEDs
MOV A,B
RLC               ; move the light one place left
MOV B,A
CALL DELAY
JMP LOOP

DELAY: MVI C,60H
WAIT: DCR C
JNZ WAIT
RET`,
    setup: {
      memory: ["No data-memory setup is required."],
      ports: [
        "8255 at 80H (PA 80H, PB 81H, PC 82H, CW 83H) in the I/O chips column.",
        "Click the Port C switches while it runs; Port B copies them.",
      ],
    },
    expectedResult:
      "The control word shows 89H (Mode 0 · Port A out · Port B out · Port C in), one Port A LED walks left forever, and Port B always equals the Port C switches.",
    tips: [
      "Run at 1000 instructions per second to see the light move.",
      "Bit 7 = 1 makes the byte a mode-set control word; bits 4, 3 and 0 set Port A, upper C and lower C as inputs when 1.",
      "Writing a mode-set control word clears every output latch, so program the 8255 before writing the ports.",
      "IN from an output port returns its latch; IN from an input port returns the switches.",
    ],
    usesChips: true,
  },
  {
    id: "pio-8155-timer-counter",
    title: "8155 timer: square wave and period counter",
    difficulty: "Intermediate",
    learningGoal:
      "Load the 8155 timer, start a continuous square wave and count terminal counts by polling the status register.",
    source: `; 8155: square wave on TIMER OUT, Port A counts timer periods,
; Port B switches are saved in the 8155 RAM.
; Choosing this example switches on 8255 / 8155: Virtual.
; Different kit address? Change P8155/RAM8155 here and the bases on the 8155 card.
P8155 EQU 20H       ; 8155 base port
CMDST EQU P8155     ; command (write) / status (read)  20H
PA55 EQU P8155+1    ; Port A                           21H
PB55 EQU P8155+2    ; Port B                           22H
TLOW EQU P8155+4    ; timer count low byte             24H
THIGH EQU P8155+5   ; timer mode + count high bits     25H
RAM8155 EQU 2800H   ; 8155 RAM

ORG 2000H
MVI A,0E8H        ; count low byte (count 03E8H = 1000)
OUT TLOW
MVI A,43H         ; 01 000011: mode 01 square wave, count high bits 03H
OUT THIGH
MVI A,0C1H        ; command 1100 0001: start timer, A out, B in, C in
OUT CMDST
MVI B,00H         ; timer periods seen

WAIT: IN CMDST    ; read the status register
ANI 40H           ; D6 TIMER = terminal count (reading status clears it)
JZ WAIT
INR B             ; one more period
MOV A,B
OUT PA55          ; show the count on the Port A LEDs
IN PB55           ; read the Port B switches
STA RAM8155       ; keep them in the 8155 RAM
JMP WAIT`,
    setup: {
      memory: ["No data-memory setup is required."],
      ports: [
        "8155 at 20H (CMD 20H, PA 21H, PB 22H, PC 23H, TL 24H, TH 25H) in the I/O chips column.",
        "Click the Port B switches, then View in memory to see them at 2800H.",
      ],
    },
    expectedResult:
      "The OLED shows a continuous square wave (3.07 kHz, 163 µs on / 163 µs off on a 3.072 MHz kit), Port A counts up in binary once per timer period, and 2800H holds the Port B switches.",
    tips: [
      "Run at 1000 instructions per second to watch Port A count.",
      "TH bits 7-6 select the mode (01 = continuous square wave); bits 5-0 are count bits 13-8.",
      "Command bits 7-6 = 11 start the timer; bit 0 = 1 makes Port A an output.",
      "On a real kit the count would rise about 3,072 times a second; the simulator counts T-states, so it is slower.",
    ],
    usesChips: true,
  },
] as const satisfies readonly Example8085[];

export const defaultBeginnerExample: Example8085 = examples8085[0];

export const instructionCategories = [
  {
    id: "data-transfer",
    title: "Data transfer",
    summary: "Move bytes or load addresses without performing arithmetic.",
    mnemonics: ["MOV", "MVI", "LDA", "STA", "LXI", "LDAX", "STAX"],
  },
  {
    id: "arithmetic",
    title: "Arithmetic",
    summary: "Add, subtract, increment, decrement, and adjust BCD values.",
    mnemonics: ["ADD", "ADC", "ADI", "ACI", "SUB", "SBB", "INR", "DCR", "DAA"],
  },
  {
    id: "logic",
    title: "Logic and compare",
    summary: "Combine, test, rotate, complement, or compare bits and bytes.",
    mnemonics: ["ANA", "ORA", "XRA", "CMP", "CMA", "RLC", "RRC"],
  },
  {
    id: "branch",
    title: "Branch and subroutine",
    summary: "Change execution flow using labels, flags, calls, and returns.",
    mnemonics: ["JMP", "JZ", "JNZ", "JC", "JNC", "CALL", "RET"],
  },
  {
    id: "machine-control",
    title: "Stack, I/O, and control",
    summary: "Use the stack, communicate with ports, or stop the processor.",
    mnemonics: ["PUSH", "POP", "IN", "OUT", "XTHL", "SPHL", "HLT"],
  },
] as const satisfies readonly InstructionCategory[];

export default defaultBeginnerExample;
