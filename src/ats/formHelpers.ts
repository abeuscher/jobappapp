import type { Locator, Page } from "playwright";

/**
 * Best-effort form filling shared by adapters. ATS forms vary per company
 * (custom fields, re-skinned boards), so every helper degrades gracefully:
 * failures are reported to the review gate, never fatal — the human can fix
 * anything by hand in the live browser before submitting.
 */

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const loc of locators) {
    try {
      const first = loc.first();
      if ((await loc.count()) > 0 && (await first.isVisible())) return first;
    } catch {
      // ignore and try next strategy
    }
  }
  return null;
}

/** Try a list of label regexes and CSS selectors until one matches a visible field. */
export async function fillField(
  page: Page,
  opts: { labels?: RegExp[]; selectors?: string[] },
  value: string
): Promise<boolean> {
  if (!value) return false;
  const candidates: Locator[] = [];
  for (const sel of opts.selectors ?? []) candidates.push(page.locator(sel));
  for (const re of opts.labels ?? []) {
    candidates.push(page.getByLabel(re));
    candidates.push(page.getByPlaceholder(re));
  }
  const field = await firstVisible(candidates);
  if (!field) return false;
  try {
    await field.fill(value, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Upload the resume PDF into the most plausible file input. */
export async function uploadResume(page: Page, resumePath: string): Promise<boolean> {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  if (count === 0) return false;
  // Prefer a file input whose id/name/data attributes mention "resume".
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const meta = (
      (await input.getAttribute("id")) ??
      ""
    ) + ((await input.getAttribute("name")) ?? "");
    if (/resume|cv/i.test(meta)) {
      try {
        await input.setInputFiles(resumePath, { timeout: 5000 });
        return true;
      } catch {
        // fall through to first-input fallback
      }
    }
  }
  try {
    await inputs.first().setInputFiles(resumePath, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Fill a textarea associated with a question label (used for reviewed answers). */
export async function fillQuestionText(
  page: Page,
  questionLabel: string,
  text: string
): Promise<boolean> {
  // Escape regex metacharacters in the label, then match loosely.
  const escaped = questionLabel.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  const field = await firstVisible([
    page.getByLabel(re),
    page.locator("label", { hasText: re }).locator("xpath=following::textarea[1]"),
    page.locator("label", { hasText: re }).locator("xpath=following::input[@type='text'][1]"),
  ]);
  if (!field) return false;
  try {
    await field.fill(text, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Click a submit button. Only ever called after explicit human approval. */
export async function clickSubmit(page: Page, patterns: RegExp[]): Promise<boolean> {
  for (const re of patterns) {
    const btn = await firstVisible([
      page.getByRole("button", { name: re }),
      page.locator('input[type="submit"]'),
    ]);
    if (btn) {
      try {
        await btn.click({ timeout: 10000 });
        return true;
      } catch {
        // try next pattern
      }
    }
  }
  return false;
}

export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Strip HTML to readable text for JD storage/prompting. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
