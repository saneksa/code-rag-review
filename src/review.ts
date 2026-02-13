import { readFile } from "node:fs/promises";
import path from "node:path";
import { getWorkingTreeDiff } from "./git.js";
import { OllamaClient } from "./ollama.js";
import { loadManifest, vectorSearch } from "./store.js";
import type { RetrievalResult } from "./types.js";

const REVIEW_SYSTEM_PROMPT = `
Ты старший инженер и проводишь code review.
Используй только предоставленные diff и контекст RAG.
Если данных недостаточно, явно напиши это.
Формат ответа:
1) Findings (критичные/важные/minor) с файлами и строками, если возможно.
2) Риски регрессий.
3) Короткий список конкретных фиксов.
Отвечай на языке пользователя.
`.trim();

export interface ReviewOptions {
  repoRoot: string;
  indexDir: string;
  ollamaUrl: string;
  reviewModel: string;
  query: string;
  topK: number;
  maxDiffChars: number;
  diffFile?: string;
  embeddingModel?: string;
}

export interface ReviewResult {
  output: string;
  retrieval: RetrievalResult[];
  usedDiff: string;
}

function formatChunkForPrompt(result: RetrievalResult): string {
  const chunk = result.chunk;
  return [
    `Score: ${result.score.toFixed(4)}`,
    `Path: ${chunk.path}:${chunk.startLine}-${chunk.endLine}`,
    "```",
    chunk.content,
    "```"
  ].join("\n");
}

function buildPrompt(params: {
  query: string;
  diff: string;
  contexts: RetrievalResult[];
}): string {
  const contextBlocks =
    params.contexts.length === 0
      ? "RAG контекст не найден."
      : params.contexts.map((ctx) => formatChunkForPrompt(ctx)).join("\n\n");

  return `
Задача ревью:
${params.query}

Diff:
${params.diff || "Diff не найден"}

RAG контекст:
${contextBlocks}
`.trim();
}

async function loadDiff(repoRoot: string, diffFile?: string): Promise<string> {
  if (diffFile) {
    const absDiffPath = path.isAbsolute(diffFile) ? diffFile : path.join(repoRoot, diffFile);
    return (await readFile(absDiffPath, "utf8")).trim();
  }
  return getWorkingTreeDiff(repoRoot);
}

function resolveEmbeddingModel(indexEmbeddingModel: string, override?: string): string {
  return override ?? indexEmbeddingModel;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[...truncated...]`;
}

function renderSearchQuery(query: string, diff: string): string {
  return `${query}\n\n${truncate(diff, 4000)}`;
}

export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  const absIndexDir = path.isAbsolute(options.indexDir)
    ? options.indexDir
    : path.join(options.repoRoot, options.indexDir);
  const manifest = await loadManifest(absIndexDir);
  if (!manifest) {
    throw new Error(`Index not found in ${absIndexDir}. Run 'code-rag index' first.`);
  }

  const diff = truncate(await loadDiff(options.repoRoot, options.diffFile), options.maxDiffChars);
  if (!diff && !options.query) {
    throw new Error("No review input: pass --query or provide a git diff.");
  }

  const embeddingModel = resolveEmbeddingModel(manifest.embeddingModel, options.embeddingModel);
  const client = new OllamaClient({ baseUrl: options.ollamaUrl });

  const retrievalQuery = renderSearchQuery(options.query, diff);
  const queryEmbedding = await client.embedSingle(embeddingModel, retrievalQuery);
  const retrieval = await vectorSearch(absIndexDir, queryEmbedding, options.topK);

  const prompt = buildPrompt({
    query: options.query,
    diff,
    contexts: retrieval
  });

  const output = await client.generate(options.reviewModel, prompt, REVIEW_SYSTEM_PROMPT);
  return { output, retrieval, usedDiff: diff };
}
