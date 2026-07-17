import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Profile } from "./types.js";

/** All state lives in version-controlled files at the repo root (spec §3). */
export const ROOT = process.env.JOBAPP_ROOT ?? process.cwd();

export const PATHS = {
  profile: path.join(ROOT, "profile.yaml"),
  corpusDir: path.join(ROOT, "corpus"),
  resumesDir: path.join(ROOT, "resumes"),
  queue: path.join(ROOT, "queue.jsonl"),
  log: path.join(ROOT, "applications.log"),
};

export const REVIEW_PORT = Number(process.env.JOBAPP_REVIEW_PORT ?? 4321);

export function loadProfile(): Profile {
  if (!fs.existsSync(PATHS.profile)) {
    throw new Error(
      `profile.yaml not found at ${PATHS.profile}. Copy profile.example.yaml and fill it in.`
    );
  }
  const profile = YAML.parse(fs.readFileSync(PATHS.profile, "utf8")) as Profile;
  if (!profile?.identity?.full_name || !profile?.identity?.email) {
    throw new Error("profile.yaml must contain identity.full_name and identity.email");
  }
  return profile;
}

/** Read every markdown file in corpus/ into a single labeled blob for generation. */
export function loadCorpus(): { files: string[]; text: string } {
  if (!fs.existsSync(PATHS.corpusDir)) return { files: [], text: "" };
  const files = fs
    .readdirSync(PATHS.corpusDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const text = files
    .map((f) => {
      const body = fs.readFileSync(path.join(PATHS.corpusDir, f), "utf8");
      return `<corpus_file name="${f}">\n${body}\n</corpus_file>`;
    })
    .join("\n\n");
  return { files, text };
}

/** List available resume variants (pre-built ATS-clean PDFs, spec §3.3). */
export function listResumeVariants(): { name: string; path: string }[] {
  if (!fs.existsSync(PATHS.resumesDir)) return [];
  return fs
    .readdirSync(PATHS.resumesDir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => ({ name: f.replace(/\.pdf$/i, ""), path: path.join(PATHS.resumesDir, f) }));
}
