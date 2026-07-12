import { describe, expect, test } from "bun:test";
import { SEARCH_CHUNK_CHARACTERS, SEARCH_CHUNK_OVERLAP_CHARACTERS, splitSearchText } from "./search-chunks";

describe("mail search chunks", () => {
  test("keeps boundary-spanning phrases in at least one chunk", () => {
    const prefix = "a".repeat(SEARCH_CHUNK_CHARACTERS - 4);
    const phrase = "boundary phrase remains searchable";
    const chunks = splitSearchText(`${prefix}${phrase}${"z".repeat(SEARCH_CHUNK_OVERLAP_CHARACTERS)}`);
    expect(chunks.length).toBe(2);
    expect(chunks.some((chunk) => chunk.includes(phrase))).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= SEARCH_CHUNK_CHARACTERS)).toBe(true);
  });

  test("does not create an empty trailing chunk", () => {
    expect(splitSearchText("x".repeat(SEARCH_CHUNK_CHARACTERS))).toHaveLength(1);
    expect(splitSearchText("")).toEqual([]);
  });
});
