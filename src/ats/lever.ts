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
  uploadResume,
} from "./formHelpers.js";

/**
 * Lever adapter. JD fetch via the public postings API
 * (api.lever.co/v0/postings) rather than scraping (spec §5.1).
 * Recognized URL shapes:
 *   https://jobs.lever.co/{company}/{posting-uuid}
 *   https://jobs.eu.lever.co/{company}/{posting-uuid}
 */

const HOSTS = /^jobs(\.eu)?\.lever\.co$/;

export function parseLeverUrl(
  url: string
): { company: string; postingId: string; eu: boolean } | null {
  try {
    const u = new URL(url);
    if (!HOSTS.test(u.hostname)) return null;
    const m = u.pathname.match(
      /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { company: m[1], postingId: m[2], eu: u.hostname.includes(".eu.") };
  } catch {
    return null;
  }
}

interface LeverPosting {
  text: string; // role title
  categories?: { location?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  applyUrl?: string;
  hostedUrl?: string;
}

export const leverAdapter: AtsAdapter = {
  name: "lever",

  matches(url: string): boolean {
    return parseLeverUrl(url) !== null;
  },

  async fetchJD(url: string): Promise<JobDescription> {
    const parsed = parseLeverUrl(url);
    if (!parsed) throw new Error(`Not a Lever URL: ${url}`);
    const apiHost = parsed.eu ? "api.eu.lever.co" : "api.lever.co";
    const api = `https://${apiHost}/v0/postings/${parsed.company}/${parsed.postingId}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`Lever API ${res.status} for ${api}`);
    const posting = (await res.json()) as LeverPosting;

    const listText = (posting.lists ?? [])
      .map((l) => `${l.text}\n${htmlToText(l.content)}`)
      .join("\n\n");
    const description =
      posting.descriptionPlain ?? htmlToText(posting.description ?? "");

    return {
      url,
      applyUrl: posting.applyUrl ?? `${url.replace(/\/$/, "")}/apply`,
      ats: "lever",
      company: parsed.company,
      role: posting.text,
      location: posting.categories?.location,
      descriptionText: [description, listText].filter(Boolean).join("\n\n"),
      // Lever's public API doesn't expose custom application questions;
      // they're discovered on the form at the review gate.
      questions: [],
    };
  },

  async fillForm(page: Page, data: ApplicationData): Promise<FilledForm> {
    const { profile, resumePath } = data;
    const filled: string[] = [];
    const skipped: string[] = [];
    const notes: string[] = [];

    await page.goto(data.jd.applyUrl, { waitUntil: "domcontentloaded" });

    (await fillField(page, { selectors: ['input[name="name"]'], labels: [/full name|^name/i] }, profile.identity.full_name)
      ? filled
      : skipped
    ).push("full name");
    (await fillField(page, { selectors: ['input[name="email"]'], labels: [/^email/i] }, profile.identity.email)
      ? filled
      : skipped
    ).push("email");
    (await fillField(page, { selectors: ['input[name="phone"]'], labels: [/phone/i] }, profile.identity.phone)
      ? filled
      : skipped
    ).push("phone");
    if (profile.location) {
      (await fillField(page, { selectors: ['input[name="location"]'], labels: [/location|city/i] }, profile.location)
        ? filled
        : skipped
      ).push("location");
    }
    const urls = [
      ["linkedin", profile.links?.linkedin, 'input[name="urls[LinkedIn]"]', /linkedin/i],
      ["github", profile.links?.github, 'input[name="urls[GitHub]"]', /github/i],
      ["portfolio", profile.links?.portfolio, 'input[name="urls[Portfolio]"]', /portfolio|website/i],
    ] as const;
    for (const [label, value, selector, re] of urls) {
      if (!value) continue;
      (await fillField(page, { selectors: [selector], labels: [re] }, value)
        ? filled
        : skipped
      ).push(label);
    }

    (await uploadResume(page, resumePath)) ? filled.push("resume") : skipped.push("resume");

    notes.push("Lever custom questions (if any) are on the form — review in the browser.");
    return { filled, skipped, notes };
  },

  async fillReviewedText(page: Page, review: ReviewedContent): Promise<string[]> {
    const failures: string[] = [];
    if (review.customization) {
      const ok =
        (await fillField(page, { selectors: ['textarea[name="comments"]'], labels: [/additional information|cover letter/i] }, review.customization)) ||
        (await fillQuestionText(page, "cover letter", review.customization));
      if (!ok) failures.push("customization (no cover-letter/comments field — paste manually)");
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
