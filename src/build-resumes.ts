import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "./browser.js";
import { PATHS } from "./config.js";

/**
 * Render resumes/*.md to ATS-clean PDFs (resumes/*.pdf) via headless Chromium.
 *
 * Output is deliberately boring: single column, real text (no images, tables,
 * or multi-column layout), standard fonts — exactly what ATS parsers want.
 * PDFs are gitignored; run `npm run resumes` locally after editing the .md.
 */

const PLACEHOLDER_RE = /\[(phone|email|FILL|VERIFY)[^\]]*\]/g;

/** Minimal markdown renderer for the constrained subset resumes use. */
function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const body = md.replace(/<!--[\s\S]*?-->/g, ""); // strip variant comments
  const lines = body.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) {
      closeList();
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push("<hr>");
    } else if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt;
         color: #111; line-height: 1.38; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2pt; }
  h2 { font-size: 12pt; margin: 12pt 0 4pt; text-transform: uppercase;
       letter-spacing: 0.06em; border-bottom: 0.75pt solid #999; padding-bottom: 2pt; }
  h3 { font-size: 11pt; font-weight: normal; font-style: italic; margin: 0 0 6pt; }
  p  { margin: 4pt 0; }
  ul { margin: 2pt 0 6pt; padding-left: 14pt; }
  li { margin: 1.5pt 0; }
  hr { border: none; border-top: 0.75pt solid #bbb; margin: 8pt 0; }
  strong { font-weight: 600; }
`;

async function main() {
  const dir = PATHS.resumesDir;
  const sources = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort();
  if (!sources.length) {
    console.log("No resume .md sources found in resumes/.");
    return;
  }

  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    for (const file of sources) {
      const md = fs.readFileSync(path.join(dir, file), "utf8");
      const leftovers = [...new Set(md.match(PLACEHOLDER_RE) ?? [])];
      if (leftovers.length) {
        console.warn(`⚠ ${file} has unresolved placeholders: ${leftovers.join(", ")}`);
      }
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${mdToHtml(md)}</body></html>`;
      await page.setContent(html, { waitUntil: "load" });
      const pdfPath = path.join(dir, file.replace(/\.md$/, ".pdf"));
      await page.pdf({
        path: pdfPath,
        format: "Letter",
        margin: { top: "0.6in", bottom: "0.6in", left: "0.7in", right: "0.7in" },
        printBackground: false,
      });
      console.log(`✓ ${path.basename(pdfPath)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
