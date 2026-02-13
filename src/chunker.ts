export interface ChunkPart {
  startLine: number;
  endLine: number;
  content: string;
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
      content: lines.slice(start, end).join("\n")
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
