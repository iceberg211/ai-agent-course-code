export interface KnowledgeDocumentChunk {
  pageContent: string;
}

export interface RecursiveChunkSplitter {
  createDocuments(texts: string[]): Promise<KnowledgeDocumentChunk[]>;
}

export interface SemanticChunkEmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export interface KnowledgeDocumentChunkingOptions {
  semanticChunking?: {
    enabled: boolean;
    embeddings: SemanticChunkEmbeddingProvider;
    similarityThreshold?: number;
    maxChunkLength?: number;
  };
}

interface MarkdownHeading {
  level: number;
  line: string;
}

interface MarkdownSection {
  headings: MarkdownHeading[];
  bodyLines: string[];
}

const STRUCTURED_CHUNK_MAX_LENGTH = 900;
const DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD = 0.76;
const DEFAULT_SEMANTIC_CHUNK_MAX_LENGTH = 900;

export async function splitKnowledgeDocumentContent(
  content: string,
  fallbackSplitter: RecursiveChunkSplitter,
  options: KnowledgeDocumentChunkingOptions = {},
): Promise<KnowledgeDocumentChunk[]> {
  if (!hasMarkdownHeading(content)) {
    const semanticChunks = await trySplitBySemanticBoundary(content, options);
    if (semanticChunks) return semanticChunks;
  }

  if (!hasMarkdownHeading(content)) {
    return fallbackSplitter.createDocuments([content]);
  }

  const sections = buildMarkdownSections(content)
    .map(formatMarkdownSection)
    .filter((section) => section.length > 0);

  if (sections.length === 0) {
    return fallbackSplitter.createDocuments([content]);
  }

  const chunks: KnowledgeDocumentChunk[] = [];
  for (const section of sections) {
    if (section.length > STRUCTURED_CHUNK_MAX_LENGTH) {
      chunks.push(...(await fallbackSplitter.createDocuments([section])));
    } else {
      chunks.push({ pageContent: section });
    }
  }

  return chunks;
}

async function trySplitBySemanticBoundary(
  content: string,
  options: KnowledgeDocumentChunkingOptions,
): Promise<KnowledgeDocumentChunk[] | null> {
  const semanticChunking = options.semanticChunking;
  if (!semanticChunking?.enabled) return null;

  const sentences = splitSentences(content);
  if (sentences.length < 3) return null;

  try {
    const vectors = await semanticChunking.embeddings.embedDocuments(sentences);
    if (vectors.length !== sentences.length) return null;

    const threshold =
      semanticChunking.similarityThreshold ??
      DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD;
    const maxChunkLength =
      semanticChunking.maxChunkLength ?? DEFAULT_SEMANTIC_CHUNK_MAX_LENGTH;
    const chunks: string[] = [];
    let current = sentences[0];

    for (let index = 1; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      const similarity = cosineSimilarity(vectors[index - 1], vectors[index]);
      const wouldExceedMax =
        current.length + sentence.length > maxChunkLength && current.length > 0;

      if (similarity < threshold || wouldExceedMax) {
        chunks.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    }

    if (current) chunks.push(current);
    if (chunks.length === 0) return null;
    return chunks.map((pageContent) => ({ pageContent }));
  } catch {
    return null;
  }
}

function splitSentences(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？；.!?;])\s*|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function hasMarkdownHeading(content: string): boolean {
  return /^#{1,6}\s+\S+/mu.test(content);
}

function buildMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  const headingStack: MarkdownHeading[] = [];
  let current: MarkdownSection | null = null;
  const preamble: string[] = [];

  const flushCurrent = () => {
    if (!current) return;
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (!heading) {
      if (current) {
        current.bodyLines.push(line);
      } else {
        preamble.push(line);
      }
      continue;
    }

    flushCurrent();
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1].level >= heading.level
    ) {
      headingStack.pop();
    }
    headingStack.push(heading);
    current = {
      headings: [...headingStack],
      bodyLines: [],
    };
  }

  flushCurrent();

  const preambleText = trimEmptyLines(preamble).join('\n').trim();
  if (preambleText) {
    sections.unshift({
      headings: [],
      bodyLines: [preambleText],
    });
  }

  return sections;
}

function parseHeading(line: string): MarkdownHeading | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    line: `${match[1]} ${match[2].trim()}`,
  };
}

function formatMarkdownSection(section: MarkdownSection): string {
  const headingText = section.headings.map((heading) => heading.line).join('\n');
  const bodyText = trimEmptyLines(section.bodyLines).join('\n').trim();

  if (!bodyText) return '';
  if (!headingText) return bodyText;
  return `${headingText}\n\n${bodyText}`;
}

function trimEmptyLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}
