import { readFile } from "node:fs/promises";
import path from "node:path";
import { chunkSourceCode, type ChunkingMode } from "./chunker.js";
import { sha256 } from "./hash.js";
import { OllamaClient } from "./ollama.js";
import { DEFAULT_EXCLUDED_DIRS, detectLanguage, scanSourceFiles } from "./scanner.js";
import { loadAllChunks, loadManifest, replaceChunks, saveManifest } from "./store.js";
import type { Chunk, IndexManifest, IndexedChunkInput } from "./types.js";

export interface IndexOptions {
  repoRoot: string;
  indexDir: string;
  embeddingModel: string;
  chunkingMode: ChunkingMode;
  chunkSize: number;
  overlapLines: number;
  maxFileSizeBytes: number;
  batchSize: number;
  excludedDirs?: string[];
  ollamaUrl: string;
}

export interface IndexStats {
  filesScanned: number;
  filesIndexed: number;
  chunksTotal: number;
  chunksEmbedded: number;
  chunksReused: number;
  indexPath: string;
}

function chunkKey(input: IndexedChunkInput): string {
  return [
    input.path,
    input.startLine,
    input.endLine,
    input.contentHash,
    input.nodeType ?? "",
    input.symbol ?? "",
    input.chunkingStrategy
  ].join(":");
}

function createChunkId(input: IndexedChunkInput): string {
  return sha256(chunkKey(input)).slice(0, 20);
}

function toPosixRelativePath(from: string, target: string): string {
  return path.relative(from, target).split(path.sep).join(path.posix.sep);
}

export async function buildIndex(options: IndexOptions): Promise<IndexStats> {
  const excludedDirs = [...DEFAULT_EXCLUDED_DIRS, ...(options.excludedDirs ?? [])];
  const absIndexDir = path.isAbsolute(options.indexDir)
    ? options.indexDir
    : path.join(options.repoRoot, options.indexDir);
  const indexDirRel = toPosixRelativePath(options.repoRoot, absIndexDir).split("/")[0] ?? ".coderag";
  const excludedWithIndex = [...new Set([...excludedDirs, indexDirRel])];

  const cache = new Map<string, Chunk>();
  const previousManifest = await loadManifest(absIndexDir);
  if (
    previousManifest &&
    previousManifest.embeddingModel === options.embeddingModel &&
    previousManifest.chunkingMode === options.chunkingMode &&
    previousManifest.chunkSize === options.chunkSize &&
    previousManifest.overlapLines === options.overlapLines
  ) {
    const previousChunks = await loadAllChunks(absIndexDir);
    for (const chunk of previousChunks) {
      cache.set(
        chunkKey({
          path: chunk.path,
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          nodeType: chunk.nodeType,
          symbol: chunk.symbol,
          chunkingStrategy: chunk.chunkingStrategy,
          contentHash: chunk.contentHash,
          fileMtimeMs: chunk.fileMtimeMs,
          fileSize: chunk.fileSize
        }),
        chunk
      );
    }
  }

  const files = await scanSourceFiles(options.repoRoot, {
    maxFileSizeBytes: options.maxFileSizeBytes,
    excludedDirs: excludedWithIndex
  });

  const pending: IndexedChunkInput[] = [];
  const chunks: Chunk[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file.absPath, "utf8");
    } catch {
      continue;
    }

    const language = detectLanguage(file.relPath);
    const parts = chunkSourceCode(content, {
      filePath: file.relPath,
      language,
      mode: options.chunkingMode,
      chunkSize: options.chunkSize,
      overlapLines: options.overlapLines
    });

    for (const part of parts) {
      const input: IndexedChunkInput = {
        path: file.relPath,
        language,
        startLine: part.startLine,
        endLine: part.endLine,
        content: part.content,
        nodeType: part.nodeType,
        symbol: part.symbol,
        chunkingStrategy: part.chunkingStrategy,
        contentHash: sha256(part.content),
        fileMtimeMs: file.mtimeMs,
        fileSize: file.size
      };

      const key = chunkKey(input);
      const cached = cache.get(key);
      if (cached) {
        chunks.push(cached);
        continue;
      }

      pending.push(input);
    }
  }

  const ollama = new OllamaClient({ baseUrl: options.ollamaUrl });
  const embeddings = await ollama.embedMany(
    options.embeddingModel,
    pending.map((chunk) => chunk.content),
    options.batchSize
  );

  if (embeddings.length !== pending.length) {
    throw new Error(
      `Embedding count mismatch: expected ${pending.length} embeddings, received ${embeddings.length}`
    );
  }

  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i];
    const embedding = embeddings[i];
    if (!item || !embedding) {
      continue;
    }
    chunks.push({
      id: createChunkId(item),
      ...item,
      embedding
    });
  }

  chunks.sort((a, b) => {
    if (a.path === b.path) {
      return a.startLine - b.startLine;
    }
    return a.path.localeCompare(b.path);
  });

  const manifest: IndexManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    embeddingModel: options.embeddingModel,
    chunkingMode: options.chunkingMode,
    chunkSize: options.chunkSize,
    overlapLines: options.overlapLines,
    excludedDirs: excludedWithIndex,
    maxFileSizeBytes: options.maxFileSizeBytes,
    filesIndexed: files.length,
    chunksIndexed: chunks.length
  };

  await replaceChunks(absIndexDir, chunks);
  await saveManifest(absIndexDir, manifest);

  return {
    filesScanned: files.length,
    filesIndexed: files.length,
    chunksTotal: chunks.length,
    chunksEmbedded: pending.length,
    chunksReused: chunks.length - pending.length,
    indexPath: absIndexDir
  };
}
