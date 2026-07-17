import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAdapter } from "../src/ats/index.js";
import { parseGreenhouseUrl } from "../src/ats/greenhouse.js";
import { parseLeverUrl } from "../src/ats/lever.js";
import { parseAshbyUrl } from "../src/ats/ashby.js";
import { htmlToText, splitName } from "../src/ats/formHelpers.js";

test("greenhouse URL parsing", () => {
  assert.deepEqual(
    parseGreenhouseUrl("https://boards.greenhouse.io/acme/jobs/4000000001"),
    { token: "acme", jobId: "4000000001", eu: false }
  );
  assert.deepEqual(
    parseGreenhouseUrl("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=abc"),
    { token: "acme", jobId: "123", eu: false }
  );
  assert.equal(parseGreenhouseUrl("https://boards.eu.greenhouse.io/acme/jobs/9")?.eu, true);
  assert.equal(parseGreenhouseUrl("https://example.com/acme/jobs/1"), null);
  assert.equal(parseGreenhouseUrl("https://boards.greenhouse.io/acme"), null);
  assert.equal(parseGreenhouseUrl("not a url"), null);
});

test("lever URL parsing", () => {
  const parsed = parseLeverUrl(
    "https://jobs.lever.co/acme/12345678-1234-1234-1234-123456789abc"
  );
  assert.deepEqual(parsed, {
    company: "acme",
    postingId: "12345678-1234-1234-1234-123456789abc",
    eu: false,
  });
  assert.equal(
    parseLeverUrl("https://jobs.eu.lever.co/acme/12345678-1234-1234-1234-123456789abc")?.eu,
    true
  );
  assert.equal(parseLeverUrl("https://jobs.lever.co/acme"), null);
  assert.equal(parseLeverUrl("https://jobs.lever.co/acme/not-a-uuid"), null);
});

test("ashby URL parsing", () => {
  const parsed = parseAshbyUrl(
    "https://jobs.ashbyhq.com/Acme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  );
  assert.deepEqual(parsed, {
    org: "Acme",
    jobId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });
  assert.equal(parseAshbyUrl("https://jobs.ashbyhq.com/Acme"), null);
  assert.equal(parseAshbyUrl("https://example.com/x/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), null);
});

test("adapter registry detection", () => {
  assert.equal(
    detectAdapter("https://boards.greenhouse.io/acme/jobs/1")?.name,
    "greenhouse"
  );
  assert.equal(
    detectAdapter("https://jobs.lever.co/acme/12345678-1234-1234-1234-123456789abc")?.name,
    "lever"
  );
  assert.equal(
    detectAdapter("https://jobs.ashbyhq.com/acme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")?.name,
    "ashby"
  );
  assert.equal(detectAdapter("https://www.linkedin.com/jobs/view/123"), undefined);
});

test("splitName", () => {
  assert.deepEqual(splitName("Jane Doe"), { first: "Jane", last: "Doe" });
  assert.deepEqual(splitName("Jane Q. van Doe"), { first: "Jane Q. van", last: "Doe" });
  assert.deepEqual(splitName("Prince"), { first: "Prince", last: "" });
});

test("htmlToText", () => {
  const text = htmlToText("<p>Hello &amp; welcome</p><ul><li>one</li><li>two</li></ul>");
  assert.match(text, /Hello & welcome/);
  assert.match(text, /- one/);
  assert.match(text, /- two/);
  assert.doesNotMatch(text, /</);
});
