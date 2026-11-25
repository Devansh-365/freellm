import { describe, expect, it } from "vitest";
import {
  StrictModeError,
  assertStrictModeAllowed,
  parseStrictHeader,
} from "../src/routing/strict.js";

describe("parseStrictHeader", () => {
  it("returns true for common truthy values", () => {
    expect(parseStrictHeader("true")).toBe(true);
    expect(parseStrictHeader("TRUE")).toBe(true);
    expect(parseStrictHeader("1")).toBe(true);
    expect(parseStrictHeader("yes")).toBe(true);
    expect(parseStrictHeader("on")).toBe(true);
    expect(parseStrictHeader("  true  ")).toBe(true);
  });

  it("returns false for missing or falsy values", () => {
    expect(parseStrictHeader(undefined)).toBe(false);
    expect(parseStrictHeader("")).toBe(false);
    expect(parseStrictHeader("false")).toBe(false);
    expect(parseStrictHeader("0")).toBe(false);
    expect(parseStrictHeader("no")).toBe(false);
    expect(parseStrictHeader(null)).toBe(false);
    expect(parseStrictHeader(42)).toBe(false);
  });
});

describe("assertStrictModeAllowed", () => {
  it("is a no-op when strict is disabled", () => {
    expect(() => assertStrictModeAllowed("free", false)).not.toThrow();
    expect(() => assertStrictModeAllowed("free-fast", false)).not.toThrow();
    expect(() => assertStrictModeAllowed("groq/openai/gpt-oss-120b", false)).not.toThrow();
  });

  it("allows concrete models in strict mode", () => {
    expect(() => assertStrictModeAllowed("groq/openai/gpt-oss-120b", true)).not.toThrow();
    expect(() => assertStrictModeAllowed("gemini/gemini-2.5-flash", true)).not.toThrow();
  });

  it("rejects every meta-model in strict mode", () => {
    for (const m of ["free", "free-fast", "free-smart"]) {
      expect(() => assertStrictModeAllowed(m, true)).toThrow(StrictModeError);
    }
  });

  it("error carries the requested model", () => {
    try {
      assertStrictModeAllowed("free-smart", true);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StrictModeError);
      expect((e as StrictModeError).requestedModel).toBe("free-smart");
      expect((e as StrictModeError).message).toMatch(/free-smart/);
    }
  });
});
