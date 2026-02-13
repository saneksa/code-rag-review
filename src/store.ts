import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import type { Chunk, IndexManifest, RetrievalResult } from "./types.js";

const CHUNKS_TABLE = "code_chunks";
const MANIFEST_FILE = "manifest.json";

function getManifestPath(indexDir: string): string {
  return path.join(indexDir, MANIFEST_FILE);
}

function toEmbeddingArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, (item) => Number(item)).filter((item) =>
      Number.isFinite(item)
    );
  }
  return [];
}

function toStringSafe(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumberSafe(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toChunkingStrategy(value: unknown): "ast" | "text" {
  return value === "ast" ? "ast" : "text";
}

function toChunk(row: Record<string, unknown>): Chunk {
  return {
    id: toStringSafe(row.id),
    path: toStringSafe(row.path),
    language: toStringSafe(row.language),
    startLine: toNumberSafe(row.startLine),
    endLine: toNumberSafe(row.endLine),
    content: toStringSafe(row.content),
    nodeType: toOptionalString(row.nodeType),
    symbol: toOptionalString(row.symbol),
    chunkingStrategy: toChunkingStrategy(row.chunkingStrategy),
    contentHash: toStringSafe(row.contentHash),
    fileMtimeMs: toNumberSafe(row.fileMtimeMs),
    fileSize: toNumberSafe(row.fileSize),
    embedding: toEmbeddingArray(row.embedding)
  };
}

function toScore(distance: unknown): number {
  const numericDistance = typeof distance === "number" ? distance : Number.NaN;
  if (!Number.isFinite(numericDistance)) {
    return 0;
  }
  return 1 / (1 + Math.max(0, numericDistance));
}

async function withConnection<T>(indexDir: string, fn: (conn: lancedb.Connection) => Promise<T>): Promise<T> {
  await mkdir(indexDir, { recursive: true });
  const connection = await lancedb.connect(indexDir);
  try {
    return await fn(connection);
  } finally {
    connection.close();
  }
}

async function openChunksTable(connection: lancedb.Connection): Promise<lancedb.Table | null> {
  const names = await connection.tableNames();
  if (!names.includes(CHUNKS_TABLE)) {
    return null;
  }
  return connection.openTable(CHUNKS_TABLE);
}

export async function loadManifest(indexDir: string): Promise<IndexManifest | null> {
  const manifestPath = getManifestPath(indexDir);
  try {
    const content = await readFile(manifestPath, "utf8");
    return JSON.parse(content) as IndexManifest;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveManifest(indexDir: string, manifest: IndexManifest): Promise<string> {
  await mkdir(indexDir, { recursive: true });
  const manifestPath = getManifestPath(indexDir);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

export async function loadAllChunks(indexDir: string): Promise<Chunk[]> {
  return withConnection(indexDir, async (connection) => {
    const table = await openChunksTable(connection);
    if (!table) {
      return [];
    }
    try {
      const rows = (await table.query().toArray()) as Record<string, unknown>[];
      return rows.map((row) => toChunk(row));
    } finally {
      table.close();
    }
  });
}

export async function replaceChunks(indexDir: string, chunks: Chunk[]): Promise<void> {
  await withConnection(indexDir, async (connection) => {
    if (chunks.length === 0) {
      const table = await openChunksTable(connection);
      if (table) {
        table.close();
        await connection.dropTable(CHUNKS_TABLE);
      }
      return;
    }

    const rows: Record<string, unknown>[] = chunks.map((chunk) => ({
      ...chunk,
      embedding: [...chunk.embedding]
    }));

    const table = await connection.createTable(CHUNKS_TABLE, rows, {
      mode: "overwrite"
    });

    try {
      await table.createIndex("embedding");
    } catch {
      // Fall back to flat scan if index creation fails.
    } finally {
      table.close();
    }
  });
}

export async function vectorSearch(indexDir: string, queryEmbedding: number[], topK: number): Promise<RetrievalResult[]> {
  return withConnection(indexDir, async (connection) => {
    const table = await openChunksTable(connection);
    if (!table) {
      return [];
    }

    try {
      const rows = (await table.vectorSearch(queryEmbedding).limit(topK).toArray()) as Array<Record<string, unknown>>;

      return rows.map((row) => ({
        score: toScore(row._distance),
        chunk: toChunk(row)
      }));
    } finally {
      table.close();
    }
  });
}
