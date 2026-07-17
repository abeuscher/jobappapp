import fs from "node:fs";
import { PATHS } from "./config.js";
import type { LogEntry, QueueEntry, QueueStatus } from "./types.js";

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function writeJsonl<T>(file: string, rows: T[]): void {
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(file, body.length ? body + "\n" : "");
}

/** Normalize a posting URL so dedup isn't defeated by tracking params/fragments. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// ---- queue.jsonl (spec §3.4) ----

export function readQueue(): QueueEntry[] {
  return readJsonl<QueueEntry>(PATHS.queue);
}

export function writeQueue(entries: QueueEntry[]): void {
  writeJsonl(PATHS.queue, entries);
}

export function addToQueue(url: string, priority = 1): QueueEntry {
  const queue = readQueue();
  const norm = normalizeUrl(url);
  const existing = queue.find((e) => normalizeUrl(e.url) === norm);
  if (existing) return existing;
  const entry: QueueEntry = {
    url,
    company: null,
    role: null,
    ats: null,
    priority,
    status: "new",
  };
  queue.push(entry);
  writeQueue(queue);
  return entry;
}

export function updateQueueEntry(
  url: string,
  patch: Partial<QueueEntry> & { status?: QueueStatus }
): void {
  const queue = readQueue();
  const norm = normalizeUrl(url);
  const entry = queue.find((e) => normalizeUrl(e.url) === norm);
  if (!entry) return;
  Object.assign(entry, patch);
  writeQueue(queue);
}

/** Next workable entry: highest priority first, then insertion order. */
export function nextQueueEntry(): QueueEntry | undefined {
  return readQueue()
    .filter((e) => e.status === "new")
    .sort((a, b) => a.priority - b.priority)[0];
}

// ---- applications.log (spec §4) ----

export function readLog(): LogEntry[] {
  return readJsonl<LogEntry>(PATHS.log);
}

export function appendLog(entry: LogEntry): void {
  fs.appendFileSync(PATHS.log, JSON.stringify(entry) + "\n");
}

/** Idempotency / no double-applies (spec §2.5): the log is the dedup source. */
export function alreadyApplied(url: string): boolean {
  const norm = normalizeUrl(url);
  return readLog().some((e) => normalizeUrl(e.url) === norm);
}
