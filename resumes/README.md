# Resume variants

Three curated, pre-vetted variants (spec §3.3, §9.1), mapped to the archetypes
in `corpus/targeting.md`:

| Variant | Archetype | Leads with |
|---|---|---|
| `generalist-builder` | Founding / early engineer | Solo-shipped products, founder-operator range |
| `ai-specialist` | LLM / AI engineer | MAIA, RAG, multi-provider LLM work, agentic workflows |
| `leadership` | Eng leadership | Company operation, cross-functional scope, team lead |

## Workflow

The `.md` files here are the source of truth — edit those. Then build the
ATS-clean PDFs the pipeline actually uploads:

```sh
npm run resumes
```

PDFs are single-column, text-only (no images/tables/columns), rendered via
headless Chromium. They are **gitignored** — regenerate locally after cloning
or editing. The build warns about unresolved `[phone]` / `[FILL]` / `[VERIFY]`
placeholders; resolve them before applying anywhere.

The Match & tailor stage selects a variant by PDF filename, so keep filenames
stable. Resumes are **not** regenerated per application (spec §9.1); per-JD
tailoring lives in the customization slot.

Dates policy: LinkedIn is the source of truth for pre-2023 roles
(see `corpus/linkedin-experience.md`).
