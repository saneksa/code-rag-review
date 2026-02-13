import path from "node:path";
import { OllamaClient } from "./ollama.js";
import { loadManifest, vectorSearch } from "./store.js";
import type { RetrievalResult } from "./types.js";

export interface SearchOptions {
  repoRoot: string;
  indexDir: string;
  ollamaUrl: string;
  query: string;
  topK: number;
  embeddingModel?: string;
}

export interface SearchResult {
  results: RetrievalResult[];
}

export async function searchIndex(options: SearchOptions): Promise<SearchResult> {
  const absIndexDir = path.isAbsolute(options.indexDir)
    ? options.indexDir
    : path.join(options.repoRoot, options.indexDir);
  const manifest = await loadManifest(absIndexDir);
  if (!manifest) {
    throw new Error(`Index not found in ${absIndexDir}. Run 'code-rag index' first.`);
  }

  const embeddingModel = options.embeddingModel ?? manifest.embeddingModel;
  const client = new OllamaClient({ baseUrl: options.ollamaUrl });
  const queryEmbedding = await client.embedSingle(embeddingModel, options.query);
  const results = await vectorSearch(absIndexDir, queryEmbedding, options.topK);
  return { results };
}
