import path from "node:path";
import { chromium } from "playwright";
import { detectAdapter } from "./ats/index.js";
import { PATHS, listResumeVariants, loadProfile } from "./config.js";
import { runReviewGate } from "./review/server.js";
import {
  alreadyApplied,
  appendLog,
  updateQueueEntry,
} from "./store.js";
import { tailor } from "./tailor.js";
import type { JobDescription, QueueEntry, TailorResult } from "./types.js";

/**
 * The five-stage pipeline (spec §5) for one queue entry:
 *   1. Ingest & classify   (ATS detect + public-API JD fetch + dedup)
 *   2. Match & tailor      (resume variant, customization slot, drafted answers)
 *   3. Fill                (Playwright, deterministic fields from profile.yaml)
 *   4. Review gate         (human edits/approves in the local web UI)
 *   5. Submit & log        (only on explicit approval)
 *
 * One application at a time, human-paced (spec §2.3). Nothing is ever
 * auto-submitted (spec §2.1).
 */

export interface IngestResult {
  jd: JobDescription;
  tailorResult: TailorResult;
}

/** Thrown when an entry is skipped by dedup — not an error condition. */
export class DedupSkip extends Error {}

/** Stages 1–2. Pure (no browser); used by both `run` and `run --dry-run`. */
export async function ingestAndTailor(entry: QueueEntry): Promise<IngestResult> {
  const adapter = detectAdapter(entry.url);
  if (!adapter) {
    throw new Error(
      `No ATS adapter matches ${entry.url}. Supported: Greenhouse, Lever, Ashby direct posting URLs.`
    );
  }

  console.log(`[1/5] Ingest: detected ${adapter.name}, fetching JD via public API…`);
  const jd = await adapter.fetchJD(entry.url);

  if (alreadyApplied(entry.url)) {
    updateQueueEntry(entry.url, {
      status: "skipped",
      company: jd.company,
      role: jd.role,
      ats: jd.ats,
      note: "already in applications.log (dedup)",
    });
    throw new DedupSkip(`Already applied to ${jd.role} @ ${jd.company} — skipping (dedup).`);
  }
  updateQueueEntry(entry.url, { company: jd.company, role: jd.role, ats: jd.ats });

  console.log(`      ${jd.role} @ ${jd.company}${jd.location ? ` (${jd.location})` : ""}`);
  console.log(`[2/5] Match & tailor…`);
  const tailorResult = await tailor(jd);
  console.log(
    `      resume: ${tailorResult.resume_variant} · ${
      tailorResult.generated ? "drafts generated" : "manual mode (no API key or empty corpus)"
    }`
  );
  return { jd, tailorResult };
}

/** Stages 3–5 for one entry. Opens a headed browser and blocks on the review gate. */
export async function processEntry(entry: QueueEntry, opts: { dryRun?: boolean } = {}) {
  updateQueueEntry(entry.url, { status: "in_progress" });
  try {
    const { jd, tailorResult } = await ingestAndTailor(entry);

    if (opts.dryRun) {
      console.log("\n--- dry run: stopping before browser fill ---");
      console.log(`Customization draft:\n${tailorResult.customization}\n`);
      for (const a of tailorResult.answers) {
        console.log(`Q: ${a.question}${a.needs_human ? "  [needs human]" : ""}\n${a.draft}\n`);
      }
      updateQueueEntry(entry.url, { status: "new" });
      return;
    }

    const profile = loadProfile();
    const variants = listResumeVariants();
    const variant =
      variants.find((v) => v.name === tailorResult.resume_variant) ?? variants[0];
    if (!variant) throw new Error("No resume PDFs in resumes/ — add at least one.");

    const adapter = detectAdapter(entry.url)!;

    console.log(`[3/5] Fill: opening browser (headed — you can intervene at any time)…`);
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    try {
      const filledForm = await adapter.fillForm(page, {
        profile,
        resumePath: variant.path,
        jd,
      });
      console.log(
        `      filled: ${filledForm.filled.join(", ") || "(none)"}` +
          (filledForm.skipped.length ? ` · needs manual: ${filledForm.skipped.join(", ")}` : "")
      );

      console.log(`[4/5] Review gate — edit and approve in the local UI.`);
      const outcome = await runReviewGate(
        {
          jd,
          tailor: tailorResult,
          filledForm,
          resumeVariant: variant.name,
        },
        {
          onFillText: (review) => adapter.fillReviewedText(page, review),
          onSubmit: async (review) => {
            // Human clicked Submit: place the final text, then submit (spec §5.5).
            await adapter.fillReviewedText(page, review);
            const result = await adapter.submit(page);
            if (result.ok) {
              appendLog({
                url: entry.url,
                company: jd.company,
                role: jd.role,
                ats: jd.ats,
                resume_variant: variant.name,
                customization: review.customization,
                custom_answers: Object.fromEntries(
                  review.answers.map((a) => [a.question, a.text])
                ),
                submitted_at: new Date().toISOString(),
                status: "submitted",
              });
              updateQueueEntry(entry.url, { status: "submitted" });
              console.log(`[5/5] Submitted and logged to ${path.basename(PATHS.log)}.`);
            }
            return result;
          },
        }
      );

      if (outcome.action === "skip") {
        updateQueueEntry(entry.url, { status: "skipped", note: outcome.note || undefined });
        console.log(`Skipped${outcome.note ? `: ${outcome.note}` : ""}.`);
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    if (err instanceof DedupSkip) {
      console.log(err.message);
      return;
    }
    updateQueueEntry(entry.url, { status: "error", note: String(err) });
    throw err;
  }
}
