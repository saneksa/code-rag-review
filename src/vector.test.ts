import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cosineSimilarity } from "./vector.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const value = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    assert.ok(Math.abs(value - 1) < 1e-6);
  });

  it("returns 0 for orthogonal vectors", () => {
    const value = cosineSimilarity([1, 0], [0, 5]);
    assert.ok(Math.abs(value) < 1e-6);
  });
});
