# Job Application Automation System — Spec

## 1. Purpose

Take a job posting URL and drive it to a submitted application in **under 5 minutes of my time**, with the tedious, deterministic 90% automated and human judgment reserved for the parts that actually convert. This is a personal tool for one operator (me), not a service.

**Inputs:** a queue of job posting URLs I've collected + a curated corpus of written material describing my career.
**Output:** a submitted application (via the employer's own ATS) + a logged record of it.

## 2. Operating principles (hard constraints)

These are non-negotiable and shape the architecture. Every component defers to these.

1. **Human-in-the-loop before every submit.** Nothing is ever auto-submitted. The system fills and drafts; I review and click send. No unattended mass-fire.
2. **Employer-ATS route only.** The system operates on employer application forms (Greenhouse / Ashby / Lever and similar), reached via direct links. It does **not** automate logged-in LinkedIn or Indeed sessions.
3. **Human pace.** One application at a time, gated by my review. No headless bulk blasting. This keeps the tool ToS-defensible and off rate-detection thresholds.
4. **Truthful by construction.**
   - Deterministic form fields (name, email, phone, links, work authorization) are read **verbatim** from my profile file. The model never generates them.
   - Any generated text (customization slot, free-text answers) may only assert claims traceable to my corpus. If a question can't be answered truthfully from the corpus, the system **flags it for manual input** rather than inventing an answer.
5. **Idempotent / no double-applies.** Every submission is logged; the queue is deduped against the log.

## 3. Inputs

All inputs are version-controlled files in the repo (except secrets).

### 3.1 `profile.yaml` — deterministic application data
Canonical, verbatim values for mechanical form fields. Single source of truth.

```yaml
identity:
  full_name: ...
  email: ...
  phone: ...
location: ...
links:
  linkedin: ...
  github: ...
  portfolio: ...
work_authorization: ...        # e.g. authorized, no sponsorship needed
compensation_expectation: ...  # optional; used only where a field requires it
eeo_self_id:                   # voluntary; my choice to fill or decline per field
  ...
```

### 3.2 `corpus/` — career material (the generation source)
The reframed founder/builder history plus prior roles, as structured markdown. Used by the generation layer for tailoring and free-text answers. Suggested files:
- `experience-bank.md` — each chapter/role with multiple bullet variants emphasizing different angles (leadership, technical depth, outcomes).
- `narrative-blocks.md` — reusable pre-written paragraphs (the "why founder-operator," the AI/agentic-workflow story, etc.).
- `facts.md` — atomic, quotable accomplishments with numbers, so generation cites real specifics.

### 3.3 `resumes/` — pre-built, ATS-clean PDF variants
A small curated set (e.g. `leadership.pdf`, `ic-technical.pdf`). The system selects the best-fit variant per JD. **Not regenerated per application** (see Open Decisions §9.1).

### 3.4 `queue.jsonl` — the URL queue
One posting per line. Minimal required field is the URL; the rest is enriched during ingest.

```json
{"url": "...", "company": null, "role": null, "ats": null, "priority": 1, "status": "new"}
```

## 4. Output

1. A submitted application on the employer's ATS.
2. An appended record in `applications.log` (JSONL / SQLite):

```json
{"url":"...","company":"...","role":"...","ats":"greenhouse",
 "resume_variant":"leadership","customization":"<final text sent>",
 "custom_answers":{...},"submitted_at":"...","status":"submitted"}
```

The log doubles as my application tracker and the dedup source.

## 5. Pipeline

Each URL flows through five stages. Stages 1–3 run unattended; stage 4 is the human gate; stage 5 fires on my approval.

**1. Ingest & classify.** Detect the ATS from the URL. Fetch the JD — prefer the ATS's **public board API** over scraping:
- Greenhouse: `boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}`
- Lever: `api.lever.co/v0/postings/{company}?mode=json`
- Ashby: public posting API by board token

Extract structured JD fields (title, company, location, JD text, and any exposed custom questions). Dedup against `applications.log`; skip if already applied.

**2. Match & tailor.** Given JD + corpus:
- Select the best-fit resume variant.
- Generate the **customization slot** (see §7).
- Draft answers to any custom free-text questions ("why us", "describe a project"), grounded in corpus.
Everything is staged for review — never sent.

**3. Fill.** Playwright drives the form via the per-ATS adapter (§6): deterministic fields from `profile.yaml`, resume upload, work-auth/EEO fields. Fills the entire mechanical portion.

**4. Review gate (the human 5 minutes).** Present the filled form + selected resume + generated customization + drafted answers. I edit the free-text, approve, or skip. Any field the system flagged as "needs truthful human input" is surfaced here.

**5. Submit & log.** On approval, submit and append to `applications.log`. On skip, mark the queue entry accordingly.

## 6. Architecture

**Per-ATS adapter interface** — a common contract, one concrete implementation per ATS. Build one first, add others behind the same interface.

```ts
interface AtsAdapter {
  matches(url: string): boolean;
  fetchJD(url: string): Promise<JobDescription>;   // via public API where possible
  fillForm(page: Page, data: ApplicationData): Promise<FilledForm>;
  submit(page: Page): Promise<SubmitResult>;
}
```

**State:** local SQLite (or JSONL) for the log + queue status.
**Generation:** Anthropic API call in the Match & tailor stage.
**Default stack:** TypeScript / Node (first-class Playwright DX + Anthropic SDK). Flippable to Python — see §9.2.

## 7. The customization slot (generation rules)

The highest-leverage text in the whole submission, because at sub-100-person companies a founder or hiring lead reads it. Rules:

- Draft from corpus + JD; make it specific to *this* role/company, not boilerplate.
- **Never fabricate.** Only claims traceable to the corpus.
- Where genuine specificity requires something the corpus can't supply (a real, personal reason I want *this* company), leave an explicit `[HUMAN: why this company]` marker rather than inventing enthusiasm. That marker surfaces at the review gate.
- Length target: 2 sentences to a short paragraph. Fits the 5-minute budget with room to tweak.

## 8. Phasing

- **v0 — prove the loop.** One ATS (whichever dominates my queue). Deterministic fill + resume upload + review gate + log + dedup. I write customization manually. Goal: reliable link→submit→log cycle.
- **v1 — generation.** Add customization slot + custom-question drafting, grounded in corpus. Add resume-variant selection.
- **v2 — coverage.** Add the remaining two ATS adapters + JD-API fetching for each.
- **v3 — optional.** Per-JD resume tailoring; analytics over `applications.log`.

## 9. Open decisions (defaults chosen; flip any)

**9.1 Resume handling — DEFAULT: curated variants.** A small set of pre-vetted, ATS-clean PDFs, best-fit selected per app; tailoring lives in the customization slot. *Why default:* regenerating a resume PDF per JD risks silently breaking ATS parsing and is a rabbit hole. Per-JD generation can arrive in v3 once the loop is trusted.

**9.2 Runtime — DEFAULT: TypeScript/Node.** Best Playwright ergonomics + Anthropic SDK. Flip to Python if preferred; Playwright Python is equally capable.

**9.3 Review gate UX — DEFAULT: minimal local web UI.** Editing free-text in a browser page beats a terminal for the review step. CLI is faster to build if you'd rather start there.

**9.4 First ATS — DEFAULT: whichever is most common in the initial URL queue.** Likely Greenhouse or Ashby given the sub-100-person target segment.

## 10. Non-goals

- No LinkedIn/Indeed session automation or scraping of gated sites.
- No unattended/bulk submission.
- No fabricated employment, credentials, or claims.
- Not a general-purpose product; single-operator tool.