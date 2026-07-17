import type { Page } from "playwright";

/** A custom question exposed by the ATS (via API or scraped from the form). */
export interface CustomQuestion {
  id?: string;
  label: string;
  required?: boolean;
  type?: string; // "text" | "textarea" | "select" | ...
}

/** Structured job description extracted during ingest. */
export interface JobDescription {
  url: string;
  applyUrl: string;
  ats: string;
  company: string;
  role: string;
  location?: string;
  descriptionText: string;
  questions: CustomQuestion[];
}

/** Deterministic application data. Read verbatim from profile.yaml — never generated. */
export interface Profile {
  identity: {
    full_name: string;
    email: string;
    phone: string;
  };
  location?: string;
  links?: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  work_authorization?: string;
  compensation_expectation?: string;
  eeo_self_id?: Record<string, string>;
}

/** A drafted answer to a custom question, grounded in the corpus. */
export interface DraftAnswer {
  question: string;
  draft: string;
  /** True when the question can't be answered truthfully from the corpus. */
  needs_human: boolean;
  reason?: string;
}

/** Output of the Match & tailor stage. */
export interface TailorResult {
  resume_variant: string;
  customization: string;
  answers: DraftAnswer[];
  /** True when generation ran (vs. v0 manual mode). */
  generated: boolean;
}

export interface ApplicationData {
  profile: Profile;
  resumePath: string;
  jd: JobDescription;
}

/** What the human edited/approved at the review gate. */
export interface ReviewedContent {
  customization: string;
  answers: { question: string; text: string }[];
}

export interface FilledForm {
  filled: string[];
  skipped: string[];
  notes: string[];
}

export interface SubmitResult {
  ok: boolean;
  message?: string;
}

/**
 * Per-ATS adapter contract (spec §6). One concrete implementation per ATS,
 * registered in src/ats/index.ts.
 */
export interface AtsAdapter {
  name: string;
  matches(url: string): boolean;
  fetchJD(url: string): Promise<JobDescription>;
  fillForm(page: Page, data: ApplicationData): Promise<FilledForm>;
  /** Place human-approved free text (customization, answers) into the form. */
  fillReviewedText(page: Page, review: ReviewedContent): Promise<string[]>;
  submit(page: Page): Promise<SubmitResult>;
}

export type QueueStatus = "new" | "in_progress" | "submitted" | "skipped" | "error";

export interface QueueEntry {
  url: string;
  company: string | null;
  role: string | null;
  ats: string | null;
  priority: number;
  status: QueueStatus;
  note?: string;
}

export interface LogEntry {
  url: string;
  company: string;
  role: string;
  ats: string;
  resume_variant: string;
  customization: string;
  custom_answers: Record<string, string>;
  submitted_at: string;
  status: "submitted";
}
