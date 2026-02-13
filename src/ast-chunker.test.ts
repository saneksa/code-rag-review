import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkSourceCode } from "./chunker.js";

describe("chunkSourceCode", () => {
  it("extracts AST chunks for TypeScript source", () => {
    const source = `
export function sum(a: number, b: number): number {
  return a + b;
}

class UserService {
  getUser(id: string) {
    return { id };
  }
}
`.trim();

    const chunks = chunkSourceCode(source, {
      filePath: "src/service.ts",
      language: "ts",
      mode: "ast",
      chunkSize: 500,
      overlapLines: 10
    });

    assert.ok(chunks.length >= 2);
    assert.ok(chunks.some((chunk) => chunk.nodeType === "FunctionDeclaration"));
    assert.ok(chunks.every((chunk) => chunk.chunkingStrategy === "ast"));
  });

  it("falls back to text chunking for unsupported language", () => {
    const source = "def foo(x):\n    return x + 1\n";
    const chunks = chunkSourceCode(source, {
      filePath: "main.py",
      language: "py",
      mode: "ast",
      chunkSize: 20,
      overlapLines: 1
    });

    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((chunk) => chunk.chunkingStrategy === "text"));
  });
});
