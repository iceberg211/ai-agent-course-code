import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_MARGIN = 40;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_CHARS_PER_LINE = 92;

function wrapText(input: string): string[] {
  const lines: string[] = [];
  const paragraphs = input.replace(/\r/g, '').split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let rest = paragraph;
    while (rest.length > MAX_CHARS_PER_LINE) {
      lines.push(rest.slice(0, MAX_CHARS_PER_LINE));
      rest = rest.slice(MAX_CHARS_PER_LINE);
    }
    lines.push(rest);
  }

  return lines;
}

export async function createPdfBufferFromText(
  title: string,
  content: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Courier);
  const lines = wrapText(content);

  let page = pdfDoc.addPage();
  let { height } = page.getSize();
  let cursorY = height - PAGE_MARGIN;

  const addNewPage = () => {
    page = pdfDoc.addPage();
    height = page.getSize().height;
    cursorY = height - PAGE_MARGIN;
  };

  page.drawText(title, {
    x: PAGE_MARGIN,
    y: cursorY,
    size: 16,
    font: titleFont,
    color: rgb(0.18, 0.12, 0.08),
  });
  cursorY -= 28;

  for (const line of lines) {
    if (cursorY <= PAGE_MARGIN) {
      addNewPage();
    }

    page.drawText(line, {
      x: PAGE_MARGIN,
      y: cursorY,
      size: FONT_SIZE,
      font: bodyFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    cursorY -= LINE_HEIGHT;
  }

  return pdfDoc.save();
}
