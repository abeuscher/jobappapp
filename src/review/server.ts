import http from "node:http";
import { REVIEW_PORT } from "../config.js";
import type { FilledForm, JobDescription, ReviewedContent, TailorResult } from "../types.js";

/**
 * Review gate (spec §5.4, §9.3): a minimal local web UI.
 *
 * This is THE human-in-the-loop control point. Nothing is ever submitted
 * except by the human clicking "Submit application" here (spec §2.1).
 * The flow is two-step by design:
 *   1. "Apply text to form" writes the edited free-text into the live browser
 *      form so the human can verify it in place (and fix anything by hand).
 *   2. "Submit application" triggers the adapter's submit, then logging.
 */

export interface ReviewGateInput {
  jd: JobDescription;
  tailor: TailorResult;
  filledForm: FilledForm;
  resumeVariant: string;
}

export interface ReviewHooks {
  /** Push edited text into the live form; returns failure notes. */
  onFillText(review: ReviewedContent): Promise<string[]>;
}

export type ReviewOutcome =
  | { action: "submit"; review: ReviewedContent }
  | { action: "skip"; note: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(input: ReviewGateInput): string {
  const { jd, tailor, filledForm } = input;
  const answersHtml = tailor.answers
    .map(
      (a, i) => `
    <div class="card ${a.needs_human ? "needs-human" : ""}">
      <label>${esc(a.question)}${a.needs_human ? ' <span class="flag">needs your input</span>' : ""}</label>
      ${a.reason ? `<p class="reason">${esc(a.reason)}</p>` : ""}
      <textarea data-question="${esc(a.question)}" id="answer-${i}" rows="5">${esc(a.draft)}</textarea>
    </div>`
    )
    .join("\n");

  const fieldList = (items: string[], cls: string) =>
    items.map((f) => `<li class="${cls}">${esc(f)}</li>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Review: ${esc(jd.role)} @ ${esc(jd.company)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 1.6rem; }
  .meta { color: #555; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.7rem 0; }
  .card.needs-human { border-color: #d97706; background: #fffbeb; }
  .flag { color: #b45309; font-size: 0.85rem; font-weight: 600; }
  .reason { color: #92400e; font-size: 0.85rem; margin: 0.2rem 0; }
  label { font-weight: 600; display: block; margin-bottom: 0.3rem; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.5rem; }
  ul.fields { columns: 2; margin: 0.3rem 0; padding-left: 1.2rem; }
  li.ok::marker { content: "✓ "; color: #16a34a; }
  li.miss::marker { content: "✗ "; color: #dc2626; }
  .notes { color: #555; font-size: 0.9rem; }
  .actions { position: sticky; bottom: 0; background: #fff; border-top: 1px solid #ddd; padding: 0.8rem 0; margin-top: 1.5rem; display: flex; gap: 0.6rem; align-items: center; }
  button { font: inherit; padding: 0.55rem 1.1rem; border-radius: 8px; border: 1px solid #999; background: #f5f5f5; cursor: pointer; }
  button.primary { background: #16a34a; border-color: #16a34a; color: #fff; font-weight: 600; }
  button.warn { background: #fff; border-color: #dc2626; color: #dc2626; }
  #status { font-size: 0.9rem; color: #333; }
  details > pre { white-space: pre-wrap; background: #f8f8f8; padding: 0.8rem; border-radius: 8px; max-height: 300px; overflow: auto; }
</style></head>
<body>
  <h1>${esc(jd.role)} <span class="meta">@ ${esc(jd.company)} · ${esc(jd.ats)}${jd.location ? " · " + esc(jd.location) : ""}</span></h1>
  <p class="meta">Resume variant: <strong>${esc(input.resumeVariant)}</strong> · Tailoring: ${tailor.generated ? "generated (grounded in corpus)" : "manual mode"}</p>

  <h2>Mechanical fields (filled by the system)</h2>
  <ul class="fields">${fieldList(filledForm.filled, "ok")}${fieldList(filledForm.skipped, "miss")}</ul>
  ${filledForm.notes.map((n) => `<p class="notes">⚠ ${esc(n)}</p>`).join("")}
  <p class="notes">The live form is open in the Playwright browser window — verify ✗ fields and dropdowns there by hand.</p>

  <h2>Customization slot</h2>
  <div class="card"><textarea id="customization" rows="6">${esc(tailor.customization)}</textarea></div>

  ${tailor.answers.length ? `<h2>Custom question answers</h2>${answersHtml}` : ""}

  <details><summary>Job description</summary><pre>${esc(jd.descriptionText.slice(0, 8000))}</pre></details>

  <div class="actions">
    <button id="fill">1 · Apply text to form</button>
    <button id="submit" class="primary">2 · Submit application</button>
    <button id="skip" class="warn">Skip</button>
    <span id="status"></span>
  </div>

<script>
  function collect() {
    return {
      customization: document.getElementById("customization").value,
      answers: Array.from(document.querySelectorAll("textarea[data-question]")).map(t => ({
        question: t.dataset.question, text: t.value
      }))
    };
  }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  }
  const status = (m) => document.getElementById("status").textContent = m;
  document.getElementById("fill").onclick = async () => {
    status("Filling form…");
    const r = await post("/api/fill-text", collect());
    status(r.failures.length ? "Could not place: " + r.failures.join("; ") : "Text placed — verify in the browser window.");
  };
  document.getElementById("submit").onclick = async () => {
    const unresolved = collect().customization.match(/\\[HUMAN:[^\\]]*\\]/) ||
      collect().answers.some(a => /\\[HUMAN:[^\\]]*\\]/.test(a.text));
    if (unresolved && !confirm("There are unresolved [HUMAN: …] markers. Submit anyway?")) return;
    if (!confirm("Submit this application?")) return;
    status("Submitting…");
    const r = await post("/api/submit", collect());
    status(r.ok ? "Submitted and logged. You can close this tab." : "Submit issue: " + (r.message || "unknown"));
  };
  document.getElementById("skip").onclick = async () => {
    const note = prompt("Skip note (optional):") || "";
    await post("/api/skip", { note });
    status("Skipped. You can close this tab.");
  };
</script>
</body></html>`;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Serve the review UI and block until the human submits or skips.
 * The returned promise resolves with the outcome; the server keeps running
 * briefly afterward so the final status renders in the browser.
 */
export function runReviewGate(
  input: ReviewGateInput,
  hooks: ReviewHooks & {
    onSubmit(review: ReviewedContent): Promise<{ ok: boolean; message?: string }>;
  }
): Promise<ReviewOutcome> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const send = (code: number, body: unknown, type = "application/json") => {
          res.writeHead(code, { "content-type": type });
          res.end(type === "text/html" ? String(body) : JSON.stringify(body));
        };

        if (req.method === "GET" && req.url === "/") {
          return send(200, renderPage(input), "text/html");
        }
        if (req.method === "POST" && req.url === "/api/fill-text") {
          const review = JSON.parse(await readBody(req)) as ReviewedContent;
          const failures = await hooks.onFillText(review);
          return send(200, { failures });
        }
        if (req.method === "POST" && req.url === "/api/submit") {
          const review = JSON.parse(await readBody(req)) as ReviewedContent;
          const result = await hooks.onSubmit(review);
          send(200, result);
          if (result.ok) {
            setTimeout(() => {
              server.close();
              server.closeAllConnections?.();
            }, 500);
            resolve({ action: "submit", review });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/api/skip") {
          const { note } = JSON.parse(await readBody(req)) as { note: string };
          send(200, { ok: true });
          setTimeout(() => server.close(), 500);
          return resolve({ action: "skip", note });
        }
        send(404, { error: "not found" });
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    server.on("error", reject);
    // Bind to loopback only — this is a single-operator local tool.
    server.listen(REVIEW_PORT, "127.0.0.1", () => {
      console.log(`\nReview gate: http://127.0.0.1:${REVIEW_PORT}/\n`);
    });
  });
}
