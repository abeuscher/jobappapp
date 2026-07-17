import type { Page } from "playwright";
import type {
  ApplicationData,
  AtsAdapter,
  FilledForm,
  JobDescription,
  ReviewedContent,
  SubmitResult,
} from "../types.js";
import {
  clickSubmit,
  fillField,
  fillQuestionText,
  htmlToText,
  splitName,
  uploadResume,
} from "./formHelpers.js";

/**
 * Ashby adapter. JD fetch via the public job-board posting API
 * (api.ashbyhq.com/posting-api) rather than scraping (spec §5.1).
 * Recognized URL shape:
 *   https://jobs.ashbyhq.com/{org}/{job-uuid}
 */

export function parseAshbyUrl(url: string): { org: string; jobId: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "jobs.ashbyhq.com") return null;
    const m = u.pathname.match(
      /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { org: decodeURIComponent(m[1]), jobId: m[2] };
  } catch {
    return null;
  }
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
}

export const ashbyAdapter: AtsAdapter = {
  name: "ashby",

  matches(url: string): boolean {
    return parseAshbyUrl(url) !== null;
  },

  async fetchJD(url: string): Promise<JobDescription> {
    const parsed = parseAshbyUrl(url);
    if (!parsed) throw new Error(`Not an Ashby URL: ${url}`);
    const api = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parsed.org)}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`Ashby API ${res.status} for ${api}`);
    const body = (await res.json()) as { jobs?: AshbyJob[] };
    const job = (body.jobs ?? []).find((j) => j.id === parsed.jobId);
    if (!job) {
      throw new Error(
        `Job ${parsed.jobId} not found on Ashby board "${parsed.org}" (it may be unlisted or closed).`
      );
    }

    return {
      url,
      applyUrl:
        job.applyUrl ?? `https://jobs.ashbyhq.com/${parsed.org}/${parsed.jobId}/application`,
      ats: "ashby",
      company: parsed.org,
      role: job.title,
      location: job.location,
      descriptionText: job.descriptionPlain ?? htmlToText(job.descriptionHtml ?? ""),
      // Ashby's public posting API doesn't expose application questions;
      // they're discovered on the form at the review gate.
      questions: [],
    };
  },

  async fillForm(page: Page, data: ApplicationData): Promise<FilledForm> {
    const { profile, resumePath } = data;
    const { first, last } = splitName(profile.identity.full_name);
    const filled: string[] = [];
    const skipped: string[] = [];
    const notes: string[] = [];

    await page.goto(data.jd.applyUrl, { waitUntil: "domcontentloaded" });
    // Ashby postings show an "Application" tab next to "Overview".
    try {
      const tab = page.getByRole("tab", { name: /application/i }).first();
      if (await tab.isVisible({ timeout: 2000 })) await tab.click();
    } catch {
      // already on the form
    }

    // Ashby is a React form with label-wrapped inputs; label matching is the
    // reliable strategy. Some boards use a single "Name" field.
    const usedFullName = await fillField(
      page,
      { labels: [/^full name/i, /^name$/i] },
      profile.identity.full_name
    );
    if (usedFullName) {
      filled.push("name");
    } else {
      (await fillField(page, { labels: [/first name/i] }, first) ? filled : skipped).push(
        "first name"
      );
      (await fillField(page, { labels: [/last name/i] }, last) ? filled : skipped).push(
        "last name"
      );
    }
    (await fillField(page, { labels: [/^email/i] }, profile.identity.email)
      ? filled
      : skipped
    ).push("email");
    (await fillField(page, { labels: [/phone/i] }, profile.identity.phone)
      ? filled
      : skipped
    ).push("phone");
    if (profile.location) {
      (await fillField(page, { labels: [/location|city/i] }, profile.location)
        ? filled
        : skipped
      ).push("location");
    }
    if (profile.links?.linkedin) {
      (await fillField(page, { labels: [/linkedin/i] }, profile.links.linkedin)
        ? filled
        : skipped
      ).push("linkedin");
    }
    if (profile.links?.github) {
      (await fillField(page, { labels: [/github/i] }, profile.links.github)
        ? filled
        : skipped
      ).push("github");
    }
    if (profile.links?.portfolio) {
      (await fillField(page, { labels: [/website|portfolio/i] }, profile.links.portfolio)
        ? filled
        : skipped
      ).push("portfolio/website");
    }

    (await uploadResume(page, resumePath)) ? filled.push("resume") : skipped.push("resume");

    notes.push("Ashby custom questions (if any) are on the form — review in the browser.");
    return { filled, skipped, notes };
  },

  async fillReviewedText(page: Page, review: ReviewedContent): Promise<string[]> {
    const failures: string[] = [];
    if (review.customization) {
      if (!(await fillQuestionText(page, "cover letter", review.customization))) {
        failures.push("customization (no cover-letter field — paste manually)");
      }
    }
    for (const a of review.answers) {
      if (!a.text) continue;
      if (!(await fillQuestionText(page, a.question, a.text))) {
        failures.push(`answer: "${a.question}" (paste manually)`);
      }
    }
    return failures;
  },

  async submit(page: Page): Promise<SubmitResult> {
    const ok = await clickSubmit(page, [/submit application/i, /^submit$/i]);
    return ok
      ? { ok: true }
      : { ok: false, message: "Submit button not found — submit manually in the browser." };
  },
};
