import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "./types.js";

const DEFAULT_EXCLUDED_DIRS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
  "target",
  "out",
  ".venv",
  "venv"
];

const KNOWN_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi"
]);

export interface ScanOptions {
  maxFileSizeBytes: number;
  excludedDirs?: string[];
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join(path.posix.sep);
}

async function readFirstBytes(filePath: string, bytes: number): Promise<Buffer> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / buffer.length > 0.3;
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return "text";
  }
  return ext.replace(".", "");
}

export async function scanSourceFiles(repoRoot: string, options: ScanOptions): Promise<SourceFile[]> {
  const excludedDirSet = new Set(
    [...DEFAULT_EXCLUDED_DIRS, ...(options.excludedDirs ?? [])].map((entry) => entry.toLowerCase())
  );

  const files: SourceFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPosixPath(path.relative(repoRoot, absPath));

      if (entry.isDirectory()) {
        if (excludedDirSet.has(entry.name.toLowerCase())) {
          continue;
        }
        await walk(absPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (KNOWN_BINARY_EXTENSIONS.has(ext)) {
        continue;
      }

      const stats = await stat(absPath);
      if (stats.size > options.maxFileSizeBytes) {
        continue;
      }

      const sample = await readFirstBytes(absPath, Math.min(4096, options.maxFileSizeBytes));
      if (isProbablyBinary(sample)) {
        continue;
      }

      files.push({
        absPath,
        relPath,
        mtimeMs: stats.mtimeMs,
        size: stats.size
      });
    }
  }

  await walk(repoRoot);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

export { DEFAULT_EXCLUDED_DIRS };
