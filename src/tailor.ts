import Anthropic from "@anthropic-ai/sdk";
import { loadCorpus, listResumeVariants } from "./config.js";
import type { JobDescription, TailorResult } from "./types.js";

/**
 * Match & tailor stage (spec §5.2, §7).
 *
 * Truthful by construction (spec §2.4): generation may only assert claims
 * traceable to the corpus. Anything that needs a genuinely personal input is
 * marked [HUMAN: ...] and surfaced at the review gate — never invented.
 *
 * Without ANTHROPIC_API_KEY this degrades to v0 manual mode: the customization
 * slot and every answer become [HUMAN: ...] placeholders for the review gate.
 */

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You draft job-application materials for one specific person, grounded strictly in their career corpus.

Hard rules — these override everything else:
1. NEVER fabricate. Every factual claim (roles, outcomes, numbers, technologies, dates) must be traceable to the corpus provided. If the corpus doesn't support a claim, don't make it.
2. Where genuine specificity requires something the corpus can't supply — especially a real, personal reason for wanting THIS company — insert an explicit marker like [HUMAN: why this company] instead of inventing enthusiasm. Mark the containing answer needs_human when the marker is load-bearing.
3. The customization slot is read by a founder or hiring lead at a small company. Make it specific to this role and company using details from the job description — not boilerplate. Length: 2 sentences to a short paragraph.
4. For custom questions: draft a grounded answer when the corpus supports one; otherwise set needs_human=true with a short reason and a skeleton the human can complete.
5. Pick the resume variant whose emphasis best fits the job description. You must pick from the provided list.
6. Write in the candidate's plain first-person voice. No em-dash-studded AI cadence, no "I'm thrilled", no filler.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    resume_variant: {
      type: "string",
      description: "Exact name of the chosen resume variant from the provided list",
    },
    variant_rationale: { type: "string" },
    customization: {
      type: "string",
      description:
        "The customization slot text. 2 sentences to a short paragraph. May contain [HUMAN: ...] markers.",
    },
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          draft: { type: "string" },
          needs_human: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["question", "draft", "needs_human", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["resume_variant", "variant_rationale", "customization", "answers"],
  additionalProperties: false,
};

function manualFallback(jd: JobDescription, defaultVariant: string): TailorResult {
  return {
    resume_variant: defaultVariant,
    customization: `[HUMAN: write customization for ${jd.role} at ${jd.company}]`,
    answers: jd.questions.map((q) => ({
      question: q.label,
      draft: "[HUMAN: answer this]",
      needs_human: true,
      reason: "Generation disabled (no ANTHROPIC_API_KEY set).",
    })),
    generated: false,
  };
}

export async function tailor(jd: JobDescription): Promise<TailorResult> {
  const variants = listResumeVariants();
  if (variants.length === 0) {
    throw new Error("No resume PDFs found in resumes/. Add at least one variant.");
  }
  const defaultVariant = variants[0].name;

  const { files, text: corpusText } = loadCorpus();
  const hasKey = Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  );
  if (!hasKey || files.length === 0) {
    if (hasKey && files.length === 0) {
      console.warn("corpus/ is empty — falling back to manual mode (nothing to ground generation in).");
    }
    return manualFallback(jd, defaultVariant);
  }

  const client = new Anthropic();
  const questionsBlock = jd.questions.length
    ? jd.questions.map((q) => `- ${q.label}${q.required ? " (required)" : ""}`).join("\n")
    : "(none exposed by the ATS — more may appear on the form itself)";

  const userContent = `<resume_variants>
${variants.map((v) => v.name).join("\n")}
</resume_variants>

<career_corpus>
${corpusText}
</career_corpus>

<job_description company="${jd.company}" role="${jd.role}" location="${jd.location ?? ""}">
${jd.descriptionText.slice(0, 30000)}
</job_description>

<custom_questions>
${questionsBlock}
</custom_questions>

Select the resume variant, draft the customization slot, and draft answers to each custom question, following the hard rules.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    console.warn("Model declined the tailoring request; falling back to manual mode.");
    return manualFallback(jd, defaultVariant);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Tailoring returned no text content.");
  }
  const parsed = JSON.parse(textBlock.text) as {
    resume_variant: string;
    customization: string;
    answers: { question: string; draft: string; needs_human: boolean; reason: string }[];
  };

  // Guard: the chosen variant must exist; otherwise fall back to the first.
  const variant =
    variants.find((v) => v.name === parsed.resume_variant)?.name ?? defaultVariant;

  return {
    resume_variant: variant,
    customization: parsed.customization,
    answers: parsed.answers.map((a) => ({
      question: a.question,
      draft: a.draft,
      // A load-bearing [HUMAN:] marker always surfaces at the review gate.
      needs_human: a.needs_human || /\[HUMAN:/i.test(a.draft),
      reason: a.reason || undefined,
    })),
    generated: true,
  };
}
