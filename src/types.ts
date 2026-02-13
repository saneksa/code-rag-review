export interface Chunk {
  id: string;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  nodeType?: string;
  symbol?: string;
  chunkingStrategy: "ast" | "text";
  contentHash: string;
  fileMtimeMs: number;
  fileSize: number;
  embedding: number[];
}

export interface IndexManifest {
  version: 1;
  generatedAt: string;
  repoRoot: string;
  embeddingModel: string;
  chunkingMode: "ast" | "text";
  chunkSize: number;
  overlapLines: number;
  excludedDirs: string[];
  maxFileSizeBytes: number;
  filesIndexed: number;
  chunksIndexed: number;
}

export interface SourceFile {
  absPath: string;
  relPath: string;
  mtimeMs: number;
  size: number;
}

export interface IndexedChunkInput {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  nodeType?: string;
  symbol?: string;
  chunkingStrategy: "ast" | "text";
  contentHash: string;
  fileMtimeMs: number;
  fileSize: number;
}

export interface RetrievalResult {
  score: number;
  chunk: Chunk;
}
