import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

function readBoolean(value: string | undefined, defaultValue: boolean) {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

async function main() {
  const outputPath = resolve(
    process.env.BROWSER_SMOKE_OUTPUT ?? '/tmp/mini-manus-browser-smoke.png',
  );
  const browser = await chromium.launch({
    headless: readBoolean(process.env.BROWSER_HEADLESS, true),
    args: ['--no-sandbox'],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    await page.setContent(
      `<main style="font-family: system-ui, sans-serif; padding: 48px;">
        <h1>Mini-Manus Browser Smoke</h1>
        <p>Chromium 启动、中文字体渲染、截图写入路径均正常。</p>
      </main>`,
      { waitUntil: 'domcontentloaded' },
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });

    const title = await page.locator('h1').innerText();
    console.log(
      JSON.stringify(
        {
          ok: true,
          title,
          screenshot: outputPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
