import { chromium } from 'playwright';

/**
 * 用 Playwright 将 Markdown 文本渲染为 PDF。
 * 原生支持 CJK / emoji / 任意 Unicode，不再有 WinAnsi 编码限制。
 *
 * 流程：Markdown 文本 → HTML 模板 → Chromium headless 渲染 → PDF buffer
 */

/** 将纯文本/Markdown 简单转为 HTML（保留段落和换行） */
function textToHtml(title: string, content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 简单 Markdown 转换：标题、粗体、代码块
  const body = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  const titleEscaped = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body {
    font-family: -apple-system, "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: 12px;
    line-height: 1.6;
    color: #333;
    max-width: 700px;
    margin: 0 auto;
    padding: 40px;
  }
  h1.doc-title {
    font-size: 20px;
    color: #2d1f14;
    border-bottom: 2px solid #eee;
    padding-bottom: 8px;
    margin-bottom: 20px;
  }
  h1 { font-size: 18px; margin-top: 24px; }
  h2 { font-size: 15px; margin-top: 20px; color: #444; }
  h3 { font-size: 13px; margin-top: 16px; color: #555; }
  p { margin: 8px 0; }
  li { margin: 4px 0; }
  strong { color: #222; }
  code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
</style>
</head>
<body>
  <h1 class="doc-title">${titleEscaped}</h1>
  <p>${body}</p>
</body>
</html>`;
}

export async function createPdfBufferFromText(
  title: string,
  content: string,
): Promise<Uint8Array> {
  const html = textToHtml(title, content);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
      printBackground: true,
    });
    return new Uint8Array(pdfBuffer);
  } finally {
    await browser.close();
  }
}
