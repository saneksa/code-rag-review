import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkTextByLines } from "./chunker.js";

describe("chunkTextByLines", () => {
  it("splits text into overlapping chunks", () => {
    const text = ["a", "b", "c", "d", "e", "f"].join("\n");
    const chunks = chunkTextByLines(text, { chunkSize: 3, overlapLines: 1 });

    assert.equal(chunks.length, 5);
    assert.equal(chunks[0]?.startLine, 1);
    assert.equal(chunks[0]?.endLine, 2);
    assert.equal(chunks[1]?.startLine, 2);
    assert.equal(chunks[1]?.endLine, 3);
  });

  it("never produces empty chunk list for non-empty text", () => {
    const chunks = chunkTextByLines("single line", { chunkSize: 100, overlapLines: 10 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.content, "single line");
  });
});
