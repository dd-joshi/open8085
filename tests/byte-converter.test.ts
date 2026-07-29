import assert from "node:assert/strict";
import test from "node:test";

import {
  formatByteFields,
  parseByteInput,
} from "../lib/byteConverter.ts";

test("formats the full 8-bit range in hexadecimal, decimal, and binary", () => {
  assert.deepEqual(formatByteFields(0), {
    hex: "00",
    decimal: "0",
    binary: "00000000",
  });
  assert.deepEqual(formatByteFields(10), {
    hex: "0A",
    decimal: "10",
    binary: "00001010",
  });
  assert.deepEqual(formatByteFields(255), {
    hex: "FF",
    decimal: "255",
    binary: "11111111",
  });
});

test("accepts any converter field and normalizes hexadecimal case", () => {
  assert.deepEqual(parseByteInput("hex", "af"), {
    text: "AF",
    value: 175,
  });
  assert.deepEqual(parseByteInput("decimal", "175"), {
    text: "175",
    value: 175,
  });
  assert.deepEqual(parseByteInput("binary", "10101111"), {
    text: "10101111",
    value: 175,
  });
  assert.deepEqual(parseByteInput("hex", ""), {
    text: "",
    value: null,
  });
});

test("rejects invalid digits, oversized inputs, and values above one byte", () => {
  assert.equal(parseByteInput("hex", "GG"), null);
  assert.equal(parseByteInput("hex", "100"), null);
  assert.equal(parseByteInput("decimal", "256"), null);
  assert.equal(parseByteInput("decimal", "-1"), null);
  assert.equal(parseByteInput("binary", "000000002"), null);
  assert.equal(parseByteInput("binary", "111111111"), null);
  assert.throws(() => formatByteFields(256), /0 to 255/i);
});
