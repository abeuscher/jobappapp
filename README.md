# jobappapp

Job application automation per [spec.md](./spec.md): take a job posting URL and
drive it to a submitted application in under 5 minutes of operator time, with
the deterministic 90% automated and human judgment reserved for the parts that
convert.

**Hard constraints (spec §2), enforced by construction:**

- **Human-in-the-loop before every submit.** The only code path that submits is
  the "Submit application" button in the local review UI. Nothing is ever
  auto-submitted.
- **Employer-ATS route only.** Adapters exist for Greenhouse, Lever, and Ashby
  direct posting links. No LinkedIn/Indeed session automation.
- **Human pace.** `run` processes exactly one application, then exits.
- **Truthful by construction.** Mechanical fields come verbatim from
  `profile.yaml`; generated text is grounded in `corpus/` and anything the
  corpus can't support is flagged `[HUMAN: …]` for you at the review gate.
- **Idempotent.** Every submission is appended to `applications.log`, and the
  queue is deduped against it before any work happens.

## Setup

```sh
npm install
npx playwright install chromium   # skip if a Playwright browser is already installed

cp profile.example.yaml profile.yaml   # fill in your real values
# put 1+ ATS-clean resume PDFs in resumes/  (e.g. leadership.pdf, ic-technical.pdf)
# fill in corpus/*.md with your real career material
export ANTHROPIC_API_KEY=sk-ant-...    # optional; without it, tailoring runs in manual mode
```

## Usage

```sh
npm run app -- add "https://boards.greenhouse.io/acme/jobs/4000000001"
npm run app -- list                # queue status
npm run app -- run --dry-run       # stages 1–2 only: ingest + tailor, print drafts
npm run app -- run                 # full pipeline for the next queued entry
npm run app -- log                 # submitted applications
npm run app -- requeue <url>       # reset an errored/skipped entry
```

`run` walks one entry through the five stages (spec §5):

1. **Ingest & classify** — detect the ATS from the URL, fetch the JD via the
   ATS's public board API (never scraping where an API exists), dedup against
   `applications.log`.
2. **Match & tailor** — one Anthropic API call selects the best-fit resume
   variant, drafts the customization slot, and drafts answers to any exposed
   custom questions, grounded strictly in `corpus/`. Without an API key this
   degrades to v0 manual mode (`[HUMAN: …]` placeholders).
3. **Fill** — Playwright opens a **headed** browser and fills the mechanical
   fields from `profile.yaml` plus the resume upload. Anything it couldn't fill
   is reported for manual completion.
4. **Review gate** — a local web UI (http://127.0.0.1:4321) shows the filled
   state, the JD, and editable drafts. Flagged `[HUMAN: …]` items are
   highlighted. You edit, click **Apply text to form**, verify in the live
   browser window, then click **Submit application** — or **Skip**.
5. **Submit & log** — on your approval only, the adapter clicks submit and the
   application is appended to `applications.log` (which doubles as the tracker
   and the dedup source).

## Files

| Path | Role |
|---|---|
| `profile.yaml` | Deterministic form data (verbatim, never generated) |
| `corpus/*.md` | Career material grounding all generated text |
| `resumes/*.pdf` | Pre-built resume variants (selected, never regenerated) |
| `queue.jsonl` | URL queue, one posting per line |
| `applications.log` | JSONL log of submissions; tracker + dedup source |

## Architecture

Per-ATS adapters implement one interface (`src/types.ts` → `AtsAdapter`):
`matches`, `fetchJD` (public API), `fillForm`, `fillReviewedText`, `submit`.
Registry in `src/ats/index.ts` — add a new ATS by adding one file there.

ATS form markup varies per company, so `fillForm` is deliberately best-effort:
every miss is surfaced at the review gate rather than trusted silently, and the
headed browser is yours to correct by hand before submitting.

## Development

```sh
npm run typecheck
npm test
```

## Phasing status (spec §8)

- **v0 (prove the loop)** — done: detect → API fetch → fill → review gate → submit → log → dedup; manual mode works with no API key.
- **v1 (generation)** — done: corpus-grounded customization + answer drafting + resume-variant selection.
- **v2 (coverage)** — done: Greenhouse, Lever, and Ashby adapters with public-API JD fetch.
- **v3 (optional)** — not built: per-JD resume tailoring; analytics over `applications.log`.
