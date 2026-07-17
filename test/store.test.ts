import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// Point the store at a temp directory before importing it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobappapp-test-"));
process.env.JOBAPP_ROOT = tmp;

const store = await import("../src/store.js");

before(() => {
  fs.rmSync(path.join(tmp, "queue.jsonl"), { force: true });
  fs.rmSync(path.join(tmp, "applications.log"), { force: true });
});

test("normalizeUrl strips tracking params, fragments, and trailing slashes", () => {
  assert.equal(
    store.normalizeUrl("https://Boards.Greenhouse.io/Acme/jobs/1?gh_src=x#app"),
    "https://boards.greenhouse.io/acme/jobs/1"
  );
  assert.equal(
    store.normalizeUrl("https://boards.greenhouse.io/acme/jobs/1/"),
    "https://boards.greenhouse.io/acme/jobs/1"
  );
});

test("queue add is idempotent and picks by priority", () => {
  const url1 = "https://boards.greenhouse.io/acme/jobs/1";
  const url2 = "https://boards.greenhouse.io/acme/jobs/2";
  store.addToQueue(url1, 2);
  store.addToQueue(url1 + "?utm=x", 1); // same posting — must not duplicate
  store.addToQueue(url2, 1);
  const queue = store.readQueue();
  assert.equal(queue.length, 2);
  assert.equal(store.nextQueueEntry()?.url, url2); // lower priority number first
});

test("queue status updates persist", () => {
  const url = "https://boards.greenhouse.io/acme/jobs/2";
  store.updateQueueEntry(url, { status: "submitted", company: "Acme" });
  const entry = store.readQueue().find((e) => e.url === url);
  assert.equal(entry?.status, "submitted");
  assert.equal(entry?.company, "Acme");
  assert.equal(store.nextQueueEntry()?.url, "https://boards.greenhouse.io/acme/jobs/1");
});

test("log append + dedup (spec §2.5)", () => {
  const url = "https://jobs.lever.co/acme/12345678-1234-1234-1234-123456789abc";
  assert.equal(store.alreadyApplied(url), false);
  store.appendLog({
    url,
    company: "acme",
    role: "Engineer",
    ats: "lever",
    resume_variant: "leadership",
    customization: "hello",
    custom_answers: {},
    submitted_at: new Date().toISOString(),
    status: "submitted",
  });
  assert.equal(store.alreadyApplied(url), true);
  assert.equal(store.alreadyApplied(url + "?src=email"), true); // normalized dedup
  assert.equal(store.readLog().length, 1);
});
