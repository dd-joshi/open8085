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
    id: "largest-in-array",
    title: "Find the largest value in an array",
    difficulty: "Beginner",
    learningGoal:
      "Scan an array and use CMP plus the carry flag to keep the largest unsigned byte.",
    source: `; 2500H holds the element count.
; The array begins at 2501H.
ORG 2000H

LDA 2500H
MOV C,A
ORA A
JZ EMPTY

LXI H,2501H
MOV A,M
DCR C
JZ DONE

SCAN: INX H
CMP M
JNC KEEP
MOV A,M
KEEP: DCR C
JNZ SCAN

DONE: STA 2600H
HLT

EMPTY: MVI A,00H
STA 2600H
HLT`,
    setup: {
      memory: [
        "2500H = 06H (six elements)",
        "2501H..2506H = 14H, E2H, 7FH, A0H, 39H, C5H",
      ],
      ports: ["No I/O port setup is required."],
    },
    expectedResult:
      "2600H = E2H. If the count at 2500H is zero, the program stores 00H.",
    tips: [
      "A starts with the first element and remains the current maximum.",
      "After CMP M, CY = 1 means A is smaller than the memory byte.",
      "The count check prevents an empty array from being read.",
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

DELAY: MVI D,20H
DLOOP1: MVI E,0FFH
DLOOP2: DCR E
JNZ DLOOP2
DCR D
JNZ DLOOP1
RET`,
    setup: {
      memory: ["No data-memory setup is required."],
      ports: [
        "Configure port 01H as output and connect it to two hexadecimal/BCD LED digits.",
      ],
    },
    expectedResult:
      "Port 01H receives 00H, 01H, ... 09H, 10H, ... 99H; its final latched value is 99H.",
    tips: [
      "DAA adjusts the binary addition result into valid packed BCD.",
      "64H is 100 decimal, so B limits the example to exactly one 00-to-99 cycle.",
      "CALL needs a valid stack, which is why SP is initialized before the loop.",
      "Change the delay constants to match the simulated or physical clock speed.",
    ],
  },
  {
    id: "fibonacci-table",
    title: "Build a Fibonacci table in memory",
    difficulty: "Intermediate",
    learningGoal:
      "Generate a sequence iteratively while using registers for state and HL as an output pointer.",
    source: `; 2500H holds the number of terms.
; Store 8-bit Fibonacci terms from 2600H onward.
ORG 2000H

LDA 2500H
MOV C,A
ORA A
JZ FINISH

LXI H,2600H
MVI D,00H
MVI E,01H
MOV M,D
INX H
DCR C
JZ FINISH

MOV M,E
INX H
DCR C
JZ FINISH

FIBLOOP: MOV A,D
ADD E
MOV D,E
MOV E,A
MOV M,A
INX H
DCR C
JNZ FIBLOOP

FINISH: HLT`,
    setup: {
      memory: [
        "2500H = 0AH (generate ten terms)",
        "2600H..2609H may contain any values before execution.",
      ],
      ports: ["No I/O port setup is required."],
    },
    expectedResult:
      "2600H..2609H contain 00H, 01H, 01H, 02H, 03H, 05H, 08H, 0DH, 15H, 22H.",
    tips: [
      "D and E hold the previous two terms; A computes the next term.",
      "The early exits correctly handle requests for zero, one, or two terms.",
      "Keep the count at 0EH or less if every term must fit in eight bits.",
    ],
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
