import { detectAdapter } from "./ats/index.js";
import { processEntry } from "./pipeline.js";
import {
  addToQueue,
  nextQueueEntry,
  readLog,
  readQueue,
  updateQueueEntry,
} from "./store.js";

/**
 * CLI entry point.
 *
 *   npm run app -- add <url> [--priority N]   add a posting URL to the queue
 *   npm run app -- list                       show queue status
 *   npm run app -- run [--dry-run] [url]      process the next (or a given) entry
 *   npm run app -- log                        show submitted applications
 *   npm run app -- requeue <url>              reset an entry to "new"
 */

function usage(): never {
  console.log(`Usage:
  add <url> [--priority N]   Add a posting URL to the queue
  list                       Show the queue
  run [--dry-run] [url]      Run the pipeline for the next queued entry (or a specific url)
  log                        Show applications.log
  requeue <url>              Reset a queue entry to "new"`);
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "add": {
      const url = rest.find((a) => !a.startsWith("--"));
      if (!url) usage();
      const pIdx = rest.indexOf("--priority");
      const priority = pIdx >= 0 ? Number(rest[pIdx + 1] ?? 1) : 1;
      const adapter = detectAdapter(url);
      if (!adapter) {
        console.warn(
          "Warning: no adapter matches this URL (supported: Greenhouse, Lever, Ashby direct posting links). Added anyway."
        );
      }
      const entry = addToQueue(url, priority);
      console.log(
        `Queued (${adapter?.name ?? "unknown ATS"}, priority ${entry.priority}, status ${entry.status}).`
      );
      break;
    }
    case "list": {
      const queue = readQueue();
      if (!queue.length) return console.log("Queue is empty.");
      for (const e of queue) {
        const label = e.role ? `${e.role} @ ${e.company}` : e.url;
        console.log(
          `[${e.status.padEnd(11)}] p${e.priority} ${label}${e.note ? `  (${e.note})` : ""}`
        );
      }
      break;
    }
    case "run": {
      const dryRun = rest.includes("--dry-run");
      const url = rest.find((a) => !a.startsWith("--"));
      const entry = url
        ? readQueue().find((e) => e.url === url)
        : nextQueueEntry();
      if (!entry) {
        console.log(url ? `URL not in queue: ${url}` : "No new entries in the queue.");
        return;
      }
      await processEntry(entry, { dryRun });
      break;
    }
    case "log": {
      const log = readLog();
      if (!log.length) return console.log("No submitted applications yet.");
      for (const e of log) {
        console.log(`${e.submitted_at}  ${e.role} @ ${e.company}  [${e.ats}, ${e.resume_variant}]`);
      }
      break;
    }
    case "requeue": {
      const url = rest[0];
      if (!url) usage();
      updateQueueEntry(url, { status: "new", note: undefined });
      console.log("Reset to new.");
      break;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
