export type ByteConverterField = "hex" | "decimal" | "binary";
export type ByteConverterFields = Record<ByteConverterField, string>;

export interface ParsedByteInput {
  readonly text: string;
  readonly value: number | null;
}

const assertByte = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error("Byte value must be a whole number from 0 to 255.");
  }
};

export const formatByteFields = (value: number): ByteConverterFields => {
  assertByte(value);
  return {
    hex: value.toString(16).toUpperCase().padStart(2, "0"),
    decimal: String(value),
    binary: value.toString(2).padStart(8, "0"),
  };
};

export const parseByteInput = (
  field: ByteConverterField,
  rawValue: string,
): ParsedByteInput | null => {
  const text = field === "hex" ? rawValue.toUpperCase() : rawValue;
  const isValid =
    field === "hex"
      ? /^[0-9A-F]{0,2}$/.test(text)
      : field === "decimal"
        ? /^\d{0,3}$/.test(text)
        : /^[01]{0,8}$/.test(text);
  if (!isValid) return null;
  if (!text) return { text, value: null };

  const radix = field === "hex" ? 16 : field === "binary" ? 2 : 10;
  const value = Number.parseInt(text, radix);
  if (!Number.isFinite(value) || value > 0xff) return null;
  return { text, value };
};
