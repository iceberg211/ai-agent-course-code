export interface KnowledgeDocumentChunk {
  pageContent: string;
}

export interface RecursiveChunkSplitter {
  createDocuments(texts: string[]): Promise<KnowledgeDocumentChunk[]>;
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

export async function splitKnowledgeDocumentContent(
  content: string,
  fallbackSplitter: RecursiveChunkSplitter,
): Promise<KnowledgeDocumentChunk[]> {
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
  const headingText = section.headings
    .map((heading) => heading.line)
    .join('\n');
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
