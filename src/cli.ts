#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { buildIndex } from "./indexer.js";
import { runReview } from "./review.js";
import { searchIndex } from "./search.js";
import type { ChunkingMode } from "./chunker.js";

const program = new Command();

const DEFAULT_INDEX_DIR = ".coderag";
const DEFAULT_EMBED_MODEL =
  process.env.CODE_RAG_EMBED_MODEL ?? "nomic-embed-text-v2-moe:latest";
const DEFAULT_REVIEW_MODEL = process.env.CODE_RAG_REVIEW_MODEL ?? "qwen3:8b";
const DEFAULT_OLLAMA_URL =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  return parsed;
}

function collectList(value: string, current: string[]): string[] {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...current, ...values];
}

function parseChunkingMode(value: string): ChunkingMode {
  if (value === "ast" || value === "text") {
    return value;
  }
  throw new Error("--chunking must be one of: ast, text");
}

program
  .name("code-rag")
  .description("RAG indexing of codebases + local code review with Ollama")
  .version("0.1.0");

program
  .command("index")
  .description("Index a repository into local vector store")
  .option("--repo <path>", "repository root", process.cwd())
  .option(
    "--index-dir <path>",
    "directory for index artifacts",
    DEFAULT_INDEX_DIR,
  )
  .option(
    "--embedding-model <name>",
    "embedding model name",
    DEFAULT_EMBED_MODEL,
  )
  .option(
    "--chunking <mode>",
    "chunking mode: ast or text",
    parseChunkingMode,
    "ast",
  )
  .option(
    "--chunk-size <chars>",
    "chunk size in chars",
    (v) => parseInteger(v, "--chunk-size"),
    1400,
  )
  .option(
    "--overlap-lines <count>",
    "line overlap between chunks",
    (v) => parseInteger(v, "--overlap-lines"),
    20,
  )
  .option(
    "--max-file-size-kb <kb>",
    "max indexed file size in kilobytes",
    (v) => parseInteger(v, "--max-file-size-kb"),
    300,
  )
  .option(
    "--batch-size <count>",
    "embedding batch size",
    (v) => parseInteger(v, "--batch-size"),
    16,
  )
  .option(
    "--exclude <dirs>",
    "comma-separated excluded directories",
    collectList,
    [] as string[],
  )
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_URL)
  .action(async (options) => {
    const repoRoot = path.resolve(options.repo);
    const stats = await buildIndex({
      repoRoot,
      indexDir: options.indexDir,
      embeddingModel: options.embeddingModel,
      chunkingMode: options.chunking,
      chunkSize: options.chunkSize,
      overlapLines: options.overlapLines,
      maxFileSizeBytes: options.maxFileSizeKb * 1024,
      batchSize: options.batchSize,
      excludedDirs: options.exclude,
      ollamaUrl: options.ollamaUrl,
    });

    console.log(`Index saved: ${stats.indexPath}`);
    console.log(`Files: ${stats.filesIndexed}, chunks: ${stats.chunksTotal}`);
    console.log(
      `Embedded: ${stats.chunksEmbedded}, reused: ${stats.chunksReused}`,
    );
  });

program
  .command("review")
  .description("Run code review using git diff + RAG context")
  .option("--repo <path>", "repository root", process.cwd())
  .option(
    "--index-dir <path>",
    "directory for index artifacts",
    DEFAULT_INDEX_DIR,
  )
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_URL)
  .option(
    "--embedding-model <name>",
    "override embedding model used for retrieval",
  )
  .option("--review-model <name>", "review LLM model", DEFAULT_REVIEW_MODEL)
  .option(
    "--query <text>",
    "review task/prompt",
    "Проведи code review текущего diff",
  )
  .option(
    "--top-k <count>",
    "how many snippets to retrieve",
    (v) => parseInteger(v, "--top-k"),
    8,
  )
  .option(
    "--max-diff-chars <count>",
    "maximum diff chars passed into prompt",
    (v) => parseInteger(v, "--max-diff-chars"),
    18000,
  )
  .option("--diff-file <path>", "optional explicit diff file")
  .option("--show-sources", "print retrieved RAG snippet metadata", false)
  .action(async (options) => {
    const repoRoot = path.resolve(options.repo);
    const result = await runReview({
      repoRoot,
      indexDir: options.indexDir,
      ollamaUrl: options.ollamaUrl,
      reviewModel: options.reviewModel,
      embeddingModel: options.embeddingModel,
      query: options.query,
      topK: options.topK,
      maxDiffChars: options.maxDiffChars,
      diffFile: options.diffFile,
    });

    console.log(result.output);

    if (options.showSources) {
      console.log("\nRAG sources:");
      for (const item of result.retrieval) {
        console.log(
          `- ${item.chunk.path}:${item.chunk.startLine}-${item.chunk.endLine} (score=${item.score.toFixed(4)})`,
        );
      }
    }
  });

program
  .command("search")
  .description("Debug retrieval: search closest code chunks by query")
  .requiredOption("--query <text>", "search query")
  .option("--repo <path>", "repository root", process.cwd())
  .option(
    "--index-dir <path>",
    "directory for index artifacts",
    DEFAULT_INDEX_DIR,
  )
  .option(
    "--embedding-model <name>",
    "override embedding model used for retrieval",
  )
  .option(
    "--top-k <count>",
    "how many snippets to retrieve",
    (v) => parseInteger(v, "--top-k"),
    8,
  )
  .option("--ollama-url <url>", "Ollama base URL", DEFAULT_OLLAMA_URL)
  .action(async (options) => {
    const repoRoot = path.resolve(options.repo);
    const result = await searchIndex({
      repoRoot,
      indexDir: options.indexDir,
      ollamaUrl: options.ollamaUrl,
      query: options.query,
      topK: options.topK,
      embeddingModel: options.embeddingModel,
    });

    if (result.results.length === 0) {
      console.log("No results.");
      return;
    }

    for (const item of result.results) {
      const preview = item.chunk.content.replace(/\s+/g, " ").slice(0, 180);
      const symbol = item.chunk.symbol ? ` symbol=${item.chunk.symbol}` : "";
      const nodeType = item.chunk.nodeType ? ` node=${item.chunk.nodeType}` : "";
      console.log(
        `${item.score.toFixed(4)}  ${item.chunk.path}:${item.chunk.startLine}-${item.chunk.endLine}${nodeType}${symbol}\n${preview}\n`,
      );
    }
  });

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
