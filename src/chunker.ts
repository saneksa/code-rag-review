import path from "node:path";
import * as ts from "typescript";

export interface ChunkPart {
  startLine: number;
  endLine: number;
  content: string;
  nodeType?: string;
  symbol?: string;
  chunkingStrategy: "ast" | "text";
}

export interface ChunkOptions {
  chunkSize: number;
  overlapLines: number;
}

export function chunkTextByLines(text: string, options: ChunkOptions): ChunkPart[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const chunks: ChunkPart[] = [];

  if (lines.length === 0) {
    return chunks;
  }

  let start = 0;
  while (start < lines.length) {
    let end = start;
    let currentLength = 0;

    while (end < lines.length) {
      const line = lines[end] ?? "";
      const addLength = line.length + (end > start ? 1 : 0);
      if (currentLength + addLength > options.chunkSize && end > start) {
        break;
      }
      currentLength += addLength;
      end += 1;
      if (currentLength >= options.chunkSize) {
        break;
      }
    }

    if (end <= start) {
      end = start + 1;
    }

    chunks.push({
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join("\n"),
      chunkingStrategy: "text"
    });

    if (end >= lines.length) {
      break;
    }

    const chunkLineCount = end - start;
    const effectiveOverlap = Math.min(options.overlapLines, Math.max(0, chunkLineCount - 1));
    start = end - effectiveOverlap;
  }

  return chunks;
}

export type ChunkingMode = "ast" | "text";

export interface SourceChunkOptions extends ChunkOptions {
  filePath: string;
  language: string;
  mode: ChunkingMode;
}

const AST_SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs"
]);

const AST_SUPPORTED_LANGUAGES = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mts",
  "cts",
  "mjs",
  "cjs",
  "typescript",
  "javascript"
]);

function supportsTypeScriptAst(language: string, filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AST_SUPPORTED_EXTENSIONS.has(ext) || AST_SUPPORTED_LANGUAGES.has(language.toLowerCase());
}

function scriptKindFromFilePath(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  if (ext === ".jsx") {
    return ts.ScriptKind.JSX;
  }
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function namedNodeSymbol(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    if (node.name) {
      return node.name.getText();
    }
  }

  if (ts.isVariableStatement(node)) {
    const names = node.declarationList.declarations
      .map((declaration) => {
        if (ts.isIdentifier(declaration.name)) {
          return declaration.name.text;
        }
        return declaration.name.getText();
      })
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(", ");
    }
  }

  return undefined;
}

function isChunkableAstNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isVariableStatement(node)
  );
}

function splitLargeChunk(
  content: string,
  startLine: number,
  nodeType: string,
  symbol: string | undefined,
  options: ChunkOptions
): ChunkPart[] {
  const parts = chunkTextByLines(content, options);
  return parts.map((part) => ({
    startLine: startLine + part.startLine - 1,
    endLine: startLine + part.endLine - 1,
    content: part.content,
    nodeType,
    symbol,
    chunkingStrategy: "ast" as const
  }));
}

function chunkTypeScriptAst(text: string, filePath: string, options: ChunkOptions): ChunkPart[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromFilePath(filePath)
  );

  const chunks: ChunkPart[] = [];

  function addAstChunk(node: ts.Node): void {
    const startPos = node.getStart(sourceFile);
    const endPos = node.getEnd();
    const content = text.slice(startPos, endPos).trim();
    if (!content) {
      return;
    }

    const startLine = sourceFile.getLineAndCharacterOfPosition(startPos).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;
    const nodeType = ts.SyntaxKind[node.kind] ?? "Unknown";
    const symbol = namedNodeSymbol(node);

    if (content.length > Math.max(options.chunkSize, 1) * 1.35) {
      chunks.push(...splitLargeChunk(content, startLine, nodeType, symbol, options));
      return;
    }

    chunks.push({
      startLine,
      endLine,
      content,
      nodeType,
      symbol,
      chunkingStrategy: "ast"
    });
  }

  function visit(node: ts.Node): void {
    if (isChunkableAstNode(node)) {
      addAstChunk(node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // For very small/atypical files where no declarations were found.
  if (chunks.length === 0) {
    return chunkTextByLines(text, options);
  }

  chunks.sort((a, b) => {
    if (a.startLine === b.startLine) {
      return a.endLine - b.endLine;
    }
    return a.startLine - b.startLine;
  });

  return chunks;
}

export function chunkSourceCode(text: string, options: SourceChunkOptions): ChunkPart[] {
  if (options.mode === "ast" && supportsTypeScriptAst(options.language, options.filePath)) {
    return chunkTypeScriptAst(text, options.filePath, options);
  }
  return chunkTextByLines(text, options);
}
