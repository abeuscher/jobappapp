import fs from "node:fs";
import { chromium, type Browser, type LaunchOptions } from "playwright";

/**
 * Launch Chromium, tolerating environments where the installed browser build
 * doesn't match the Playwright package version (e.g. sandboxes with a
 * pre-provisioned Chromium at a stable path). Override with
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE, or run `npx playwright install chromium`.
 */
export async function launchChromium(opts: LaunchOptions = {}): Promise<Browser> {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit) return chromium.launch({ ...opts, executablePath: explicit });
  try {
    return await chromium.launch(opts);
  } catch (err) {
    const fallback = "/opt/pw-browsers/chromium";
    if (fs.existsSync(fallback)) {
      return chromium.launch({ ...opts, executablePath: fallback });
    }
    throw err;
  }
}
