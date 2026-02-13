export interface OllamaOptions {
  baseUrl: string;
}

interface EmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export class OllamaClient {
  private readonly baseUrl: string;

  constructor(options: OllamaOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  private async postJson<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Ollama request failed (${response.status}) ${endpoint}: ${payload}`);
    }

    return (await response.json()) as T;
  }

  async embedMany(model: string, inputs: string[], batchSize: number): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchEmbeddings = await this.embedBatch(model, batch);
      embeddings.push(...batchEmbeddings);
    }
    return embeddings;
  }

  async embedSingle(model: string, input: string): Promise<number[]> {
    const [embedding] = await this.embedBatch(model, [input]);
    if (!embedding) {
      throw new Error("Ollama returned empty embedding array");
    }
    return embedding;
  }

  private async embedBatch(model: string, inputs: string[]): Promise<number[][]> {
    try {
      const data = await this.postJson<EmbedResponse>("/api/embed", {
        model,
        input: inputs
      });
      if (Array.isArray(data.embeddings)) {
        return data.embeddings;
      }
    } catch (error) {
      if (inputs.length > 1) {
        throw error;
      }
    }

    // Compatibility fallback for older Ollama APIs that only support single embedding calls.
    const output: number[][] = [];
    for (const text of inputs) {
      const data = await this.postJson<EmbedResponse>("/api/embeddings", {
        model,
        prompt: text
      });
      if (!Array.isArray(data.embedding)) {
        throw new Error("Ollama /api/embeddings response does not contain embedding");
      }
      output.push(data.embedding);
    }
    return output;
  }

  async generate(model: string, prompt: string, system: string): Promise<string> {
    const data = await this.postJson<{ response?: string }>("/api/generate", {
      model,
      prompt,
      system,
      stream: false
    });

    if (typeof data.response !== "string") {
      throw new Error("Ollama /api/generate response does not contain response");
    }
    return data.response.trim();
  }
}
