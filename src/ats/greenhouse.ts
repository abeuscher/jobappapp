import type { Page } from "playwright";
import type {
  ApplicationData,
  AtsAdapter,
  CustomQuestion,
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
 * Greenhouse adapter. JD fetch goes through the public board API
 * (boards-api.greenhouse.io) rather than scraping (spec §5.1).
 * Recognized URL shapes:
 *   https://boards.greenhouse.io/{token}/jobs/{id}
 *   https://job-boards.greenhouse.io/{token}/jobs/{id}
 *   https://boards.eu.greenhouse.io/{token}/jobs/{id}
 */

const HOSTS = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/;

export function parseGreenhouseUrl(
  url: string
): { token: string; jobId: string; eu: boolean } | null {
  try {
    const u = new URL(url);
    if (!HOSTS.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (!m) return null;
    return { token: m[1], jobId: m[2], eu: u.hostname.includes(".eu.") };
  } catch {
    return null;
  }
}

interface GhJob {
  title: string;
  location?: { name?: string };
  content: string; // HTML-escaped HTML
  absolute_url: string;
  questions?: { label: string; required?: boolean; fields?: { type?: string }[] }[];
  company_name?: string;
}

export const greenhouseAdapter: AtsAdapter = {
  name: "greenhouse",

  matches(url: string): boolean {
    return parseGreenhouseUrl(url) !== null;
  },

  async fetchJD(url: string): Promise<JobDescription> {
    const parsed = parseGreenhouseUrl(url);
    if (!parsed) throw new Error(`Not a Greenhouse URL: ${url}`);
    const apiHost = parsed.eu
      ? "boards-api.eu.greenhouse.io"
      : "boards-api.greenhouse.io";
    const api = `https://${apiHost}/v1/boards/${parsed.token}/jobs/${parsed.jobId}?questions=true`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`Greenhouse API ${res.status} for ${api}`);
    const job = (await res.json()) as GhJob;

    const questions: CustomQuestion[] = (job.questions ?? [])
      .filter(
        (q) =>
          // Only free-text questions need drafting; mechanical fields are deterministic.
          q.fields?.some((f) => f.type === "textarea" || f.type === "input_text")
      )
      .filter(
        (q) => !/name|email|phone|resume|cover.?letter|linkedin/i.test(q.label)
      )
      .map((q) => ({ label: q.label, required: q.required, type: "text" }));

    return {
      url,
      applyUrl: job.absolute_url ?? url,
      ats: "greenhouse",
      company: job.company_name ?? parsed.token,
      role: job.title,
      location: job.location?.name,
      // content is double-encoded HTML in the boards API
      descriptionText: htmlToText(htmlToText(job.content ?? "")),
      questions,
    };
  },

  async fillForm(page: Page, data: ApplicationData): Promise<FilledForm> {
    const { profile, resumePath } = data;
    const { first, last } = splitName(profile.identity.full_name);
    const filled: string[] = [];
    const skipped: string[] = [];
    const notes: string[] = [];

    await page.goto(data.jd.applyUrl, { waitUntil: "domcontentloaded" });
    // Legacy boards render the form behind an "#app" anchor / Apply button.
    try {
      const applyBtn = page.getByRole("button", { name: /^apply/i }).first();
      if (await applyBtn.isVisible({ timeout: 2000 })) await applyBtn.click();
    } catch {
      // form is likely already visible
    }

    (await fillField(page, { selectors: ["#first_name"], labels: [/first name/i] }, first)
      ? filled
      : skipped
    ).push("first name");
    (await fillField(page, { selectors: ["#last_name"], labels: [/last name/i] }, last)
      ? filled
      : skipped
    ).push("last name");
    (await fillField(page, { selectors: ["#email"], labels: [/^email/i] }, profile.identity.email)
      ? filled
      : skipped
    ).push("email");
    (await fillField(page, { selectors: ["#phone"], labels: [/phone/i] }, profile.identity.phone)
      ? filled
      : skipped
    ).push("phone");
    if (profile.location) {
      (await fillField(page, { selectors: ["#candidate-location", "#job_application_location"], labels: [/location|city/i] }, profile.location)
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
      (await fillField(page, { labels: [/github/i] }, profile.links.github) ? filled : skipped).push(
        "github"
      );
    }
    if (profile.links?.portfolio) {
      (await fillField(page, { labels: [/website|portfolio/i] }, profile.links.portfolio)
        ? filled
        : skipped
      ).push("portfolio/website");
    }

    (await uploadResume(page, resumePath)) ? filled.push("resume") : skipped.push("resume");

    notes.push(
      "Work authorization / EEO dropdowns vary per company — review them in the browser."
    );
    return { filled, skipped, notes };
  },

  async fillReviewedText(page: Page, review: ReviewedContent): Promise<string[]> {
    const failures: string[] = [];
    if (review.customization) {
      const ok =
        (await fillQuestionText(page, "cover letter", review.customization)) ||
        (await fillField(page, { selectors: ["#cover_letter_text"], labels: [/cover letter/i] }, review.customization));
      if (!ok) failures.push("customization (cover letter field not found — paste manually)");
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
    const ok = await clickSubmit(page, [/submit application/i, /^submit$/i, /^apply$/i]);
    return ok
      ? { ok: true }
      : { ok: false, message: "Submit button not found — submit manually in the browser." };
  },
};
