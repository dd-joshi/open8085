import assert from "node:assert/strict";
import test from "node:test";

import { moveBreakpointLines } from "../lib/breakpointLines.ts";

const program = ["MVI A,05H", "MOV B,A", "LOOP: DCR B", "JNZ LOOP", "HLT"].join("\n");
const lines = (...values: number[]) => new Set(values);
const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

test("a line added above a breakpoint moves it down with its code", () => {
  const edited = ["MVI A,05H", "NOP", "MOV B,A", "LOOP: DCR B", "JNZ LOOP", "HLT"].join("\n");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(1, 4))), [1, 5]);
});

test("Enter at the start of the breakpoint line moves the breakpoint with the code", () => {
  const edited = ["MVI A,05H", "MOV B,A", "", "LOOP: DCR B", "JNZ LOOP", "HLT"].join("\n");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(3))), [4]);
});

test("Enter at the end of the breakpoint line keeps the breakpoint where it is", () => {
  const edited = ["MVI A,05H", "MOV B,A", "LOOP: DCR B", "", "JNZ LOOP", "HLT"].join("\n");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(3))), [3]);
});

test("lines deleted above a breakpoint move it up", () => {
  const edited = ["LOOP: DCR B", "JNZ LOOP", "HLT"].join("\n");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(4, 5))), [2, 3]);
});

test("typing on the breakpoint line keeps the breakpoint", () => {
  const edited = program.replace("JNZ LOOP", "JNZ LOOP ; repeat");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(4))), [4]);
});

test("a breakpoint on a deleted line is removed", () => {
  const edited = ["MVI A,05H", "MOV B,A", "HLT"].join("\n");
  assert.deepEqual(sorted(moveBreakpointLines(program, edited, lines(3, 4, 5))), [3]);
});

test("no breakpoints or no line change: same lines back", () => {
  assert.deepEqual(sorted(moveBreakpointLines(program, program + " ", lines(2, 5))), [2, 5]);
  assert.equal(moveBreakpointLines(program, "", lines()).size, 0);
});
