import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JOBAPP_REVIEW_PORT = "43219";
const { runReviewGate } = await import("../src/review/server.js");

const input = {
  jd: {
    url: "https://boards.greenhouse.io/acme/jobs/1",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    ats: "greenhouse",
    company: "Acme",
    role: "Engineer <script>",
    descriptionText: "Build things.",
    questions: [],
  },
  tailor: {
    resume_variant: "leadership",
    customization: "[HUMAN: why this company]",
    answers: [
      { question: "Why us?", draft: "Because…", needs_human: true, reason: "personal" },
    ],
    generated: true,
  },
  filledForm: { filled: ["email"], skipped: ["resume"], notes: ["check dropdowns"] },
  resumeVariant: "leadership",
};

test("review gate serves UI, applies text, and resolves only on explicit submit", async () => {
  let filledWith: unknown = null;
  let submittedWith: unknown = null;

  const outcome = runReviewGate(input, {
    onFillText: async (review) => {
      filledWith = review;
      return ["could not place answer"];
    },
    onSubmit: async (review) => {
      submittedWith = review;
      return { ok: true };
    },
  });

  const base = "http://127.0.0.1:43219";
  // Give the server a beat to bind.
  await new Promise((r) => setTimeout(r, 200));

  const page = await (await fetch(base + "/")).text();
  assert.match(page, /Engineer &lt;script&gt;/); // HTML-escaped
  assert.match(page, /needs your input/);
  assert.match(page, /Submit application/);

  const review = {
    customization: "My real reason.",
    answers: [{ question: "Why us?", text: "Edited answer." }],
  };

  const fillRes = await (
    await fetch(base + "/api/fill-text", { method: "POST", body: JSON.stringify(review) })
  ).json();
  assert.deepEqual(fillRes, { failures: ["could not place answer"] });
  assert.deepEqual(filledWith, review);
  assert.equal(submittedWith, null); // filling text must NOT submit

  const submitRes = await (
    await fetch(base + "/api/submit", { method: "POST", body: JSON.stringify(review) })
  ).json();
  assert.deepEqual(submitRes, { ok: true });
  assert.deepEqual(submittedWith, review);

  const result = await outcome;
  assert.equal(result.action, "submit");
});

test("review gate skip resolves without submitting", async () => {
  let submitted = false;
  // Wait for the previous test's server (closed on a 500ms delay) to release the port.
  await new Promise((r) => setTimeout(r, 900));
  const outcome = runReviewGate(input, {
    onFillText: async () => [],
    onSubmit: async () => {
      submitted = true;
      return { ok: true };
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  await fetch("http://127.0.0.1:43219/api/skip", {
    method: "POST",
    body: JSON.stringify({ note: "not a fit" }),
  });
  const result = await outcome;
  assert.deepEqual(result, { action: "skip", note: "not a fit" });
  assert.equal(submitted, false);
});
