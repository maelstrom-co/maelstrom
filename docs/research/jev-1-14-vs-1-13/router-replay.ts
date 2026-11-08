#!/usr/bin/env bun
/**
 * Replays labeled router cases against TypeSafe Jev and scores the route
 * choice (ui_only vs needs_tools) for accuracy and latency.
 *
 * Run from the worktree root:
 *   bun --env-file=.env docs/research/jev-1-14-vs-1-13/router-replay.ts \
 *     --model jev-1.14.0 --repeats 3 --out <file.json>
 *
 * Flags:
 *   --model <id>       pinned Jev model, required (echo is checked)
 *   --repeats <n>      passes over the case set, default 1
 *   --out <file>       write every call plus the summary as JSON
 *   --cases <file>     case file, default router-cases.json next to this script
 *   --only <id,...>    run only these case ids
 *   --timeout <ms>     per-call timeout, default 5000 (JEV_ROUTER_TIMEOUT_MS)
 *   --dry-run          print one request body and exit, no network, no key needed
 *
 * The key comes only from TYPESAFE_API_KEY and is never printed.
 * Calls run sequentially (concurrency 1) so latency is not skewed by
 * parallel load. A reply whose model differs from --model, or a 4xx other
 * than 408/429, aborts the run (partial results are still written).
 * Bun also loads .env from the working directory on its own, so any run
 * without --dry-run sends real requests.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Copied verbatim from apps/demo/src/server/agent-session.ts on branch
// ktrz/composed-planner-prototype @ febb09121b26f24c777cefe458b19b0fc349c6f8:
// JEV_ENDPOINT and JEV_ROUTER_TIMEOUT_MS at lines 112-113, the description
// constants at lines 125-128, the request body in #routeWithJev at lines
// 299-345 and #recentText (last 4 plain user/assistant messages) at 363-374.
// origin/main has no Jev router (no apps/demo/src/server/agent-session.ts).
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_ROUTER_TIMEOUT_MS = 5000;
const UI_ONLY_DESCRIPTION =
  'a single screen change that the UI can do on its own, e.g. "show my past orders", "open my most recent order", "show the cart", "make the catalog bigger", "hide checkout".';
const NEEDS_TOOLS_DESCRIPTION =
  'anything that needs looking up and reasoning over data before acting, several steps, references to earlier results ("it", "that one"), adding to cart, checkout or placing an order, comparisons, recommendations.';
const SOURCE_REF =
  "apps/demo/src/server/agent-session.ts:299-345 @ febb09121b26f24c777cefe458b19b0fc349c6f8 (ktrz/composed-planner-prototype)";

type Route = "ui_only" | "needs_tools";

interface RouterCase {
  readonly id: string;
  readonly recentConversation: readonly string[];
  readonly latestRequest: string;
  readonly expected: Route;
  readonly borderline?: boolean;
  readonly note?: string;
}

interface CallRecord {
  readonly caseId: string;
  readonly model: string;
  readonly repeat: number;
  readonly expected: Route;
  readonly borderline: boolean;
  readonly route: Route | null;
  readonly correct: boolean;
  readonly confidence: number | null;
  readonly probabilities: Record<string, number> | null;
  readonly echoedModel: string | null;
  readonly httpStatus: number | null;
  readonly wallMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
}

interface Options {
  readonly model: string;
  readonly repeats: number;
  readonly out?: string;
  readonly casesPath: string;
  readonly only?: ReadonlySet<string>;
  readonly timeoutMs: number;
  readonly dryRun: boolean;
}

class FatalReplyError extends Error {}

const options = parseArgs(process.argv.slice(2));
const cases = loadCases(options.casesPath).filter(
  (routerCase) => !options.only || options.only.has(routerCase.id),
);
if (cases.length === 0) fail("no cases selected");

if (options.dryRun) {
  const sample = cases.find((c) => c.recentConversation.length > 0) ?? cases[0];
  console.log(`POST ${JEV_ENDPOINT}`);
  console.log("Authorization: Bearer <TYPESAFE_API_KEY, redacted>");
  console.log(`case: ${sample.id} (expected ${sample.expected})`);
  console.log(JSON.stringify(requestBody(options.model, sample), null, 2));
  console.log(
    `\n${cases.length} cases x ${options.repeats} repeats = ${cases.length * options.repeats} calls (dry run, nothing sent)`,
  );
  process.exit(0);
}

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) fail("TYPESAFE_API_KEY is not set");

const startedAt = new Date().toISOString();
const calls: CallRecord[] = [];
let aborted: string | null = null;
try {
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    for (const routerCase of cases) {
      const record = await callRouter(apiKey, routerCase, repeat);
      calls.push(record);
      console.log(
        `[r${repeat}] ${routerCase.id.padEnd(40)} ${String(record.route ?? "ERROR").padEnd(11)} ${record.correct ? "ok  " : "MISS"} ${record.wallMs.toFixed(0).padStart(5)} ms${record.confidence === null ? "" : ` conf=${record.confidence.toFixed(2)}`}${record.error ? ` ${record.error}` : ""}`,
      );
    }
  }
} catch (error) {
  if (!(error instanceof FatalReplyError)) throw error;
  aborted = error.message;
}

const summary = summarize(calls);
printSummary(summary);
if (options.out) {
  writeFileSync(
    options.out,
    `${JSON.stringify(
      {
        meta: {
          model: options.model,
          repeats: options.repeats,
          endpoint: JEV_ENDPOINT,
          timeoutMs: options.timeoutMs,
          casesFile: options.casesPath,
          caseCount: cases.length,
          source: SOURCE_REF,
          startedAt,
          finishedAt: new Date().toISOString(),
          aborted,
        },
        summary,
        calls,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${options.out}`);
}
if (aborted) fail(`aborted: ${aborted}`);

function requestBody(model: string, routerCase: RouterCase) {
  return {
    model,
    state: {
      recentConversation: routerCase.recentConversation,
      latestRequest: routerCase.latestRequest,
    },
    questions: {
      route: {
        type: "choice",
        instructions:
          "Classify the customer's latest request to a pet-food shop UI.",
        criteria: {
          ui_only: UI_ONLY_DESCRIPTION,
          needs_tools: NEEDS_TOOLS_DESCRIPTION,
        },
      },
    },
  };
}

async function callRouter(
  key: string,
  routerCase: RouterCase,
  repeat: number,
): Promise<CallRecord> {
  const base = {
    caseId: routerCase.id,
    model: options.model,
    repeat,
    expected: routerCase.expected,
    borderline: routerCase.borderline === true,
  };
  const empty = {
    route: null,
    correct: false,
    confidence: null,
    probabilities: null,
    echoedModel: null,
    inputTokens: null,
    outputTokens: null,
  };
  const started = performance.now();
  let response: Response;
  let raw: unknown;
  try {
    response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(options.model, routerCase)),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    raw = await response.json().catch(() => undefined);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return {
      ...base,
      ...empty,
      httpStatus: null,
      wallMs: performance.now() - started,
      error:
        name === "TimeoutError"
          ? `timeout ${options.timeoutMs} ms`
          : `network ${name}`,
    };
  }
  const wallMs = performance.now() - started;
  const reply = isRecord(raw) ? raw : {};
  const echoedModel = typeof reply.model === "string" ? reply.model : null;
  // A 4xx other than timeout or rate limit is a request or key problem that
  // every later call would repeat.
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  )
    throw new FatalReplyError(
      `case ${routerCase.id}: HTTP ${response.status}, check --model and TYPESAFE_API_KEY`,
    );
  if (!response.ok)
    return {
      ...base,
      ...empty,
      echoedModel,
      httpStatus: response.status,
      wallMs,
      error: `HTTP ${response.status}`,
    };
  if (echoedModel !== options.model)
    throw new FatalReplyError(
      `case ${routerCase.id}: requested ${options.model}, reply echoed ${JSON.stringify(echoedModel)}`,
    );
  const answers = isRecord(reply.answers) ? reply.answers : {};
  const answer = isRecord(answers.route) ? answers.route : {};
  const usage = isRecord(reply.usage) ? reply.usage : {};
  const choice = answer.choice;
  const route: Route | null =
    choice === "ui_only" || choice === "needs_tools" ? choice : null;
  return {
    ...base,
    route,
    correct: route === routerCase.expected,
    confidence:
      typeof answer.confidence === "number" ? answer.confidence : null,
    probabilities: isRecord(answer.probabilities)
      ? (answer.probabilities as Record<string, number>)
      : null,
    echoedModel,
    httpStatus: response.status,
    wallMs,
    inputTokens:
      typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens:
      typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    error:
      route === null
        ? `no route in reply (choice=${JSON.stringify(choice)})`
        : null,
  };
}

function summarize(records: readonly CallRecord[]) {
  const answered = records.filter((r) => r.route !== null);
  const clear = records.filter((r) => !r.borderline);
  const borderline = records.filter((r) => r.borderline);
  const confusion: Record<Route, Record<Route | "error", number>> = {
    ui_only: { ui_only: 0, needs_tools: 0, error: 0 },
    needs_tools: { ui_only: 0, needs_tools: 0, error: 0 },
  };
  for (const r of records) confusion[r.expected][r.route ?? "error"]++;
  const latencies = answered.map((r) => r.wallMs).sort((a, b) => a - b);
  const flips = new Map<string, Set<string>>();
  for (const r of records) {
    const seen = flips.get(r.caseId) ?? new Set<string>();
    seen.add(r.route ?? "error");
    flips.set(r.caseId, seen);
  }
  return {
    calls: records.length,
    errors: records.length - answered.length,
    accuracy: ratio(records),
    accuracyExcludingBorderline: ratio(clear),
    accuracyBorderlineOnly: ratio(borderline),
    confusion,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? null,
    },
    unstableCases: [...flips]
      .filter(([, seen]) => seen.size > 1)
      .map(([id]) => id),
  };
}

function printSummary(s: ReturnType<typeof summarize>) {
  const pct = (a: { correct: number; total: number; rate: number | null }) =>
    `${a.correct}/${a.total}${a.rate === null ? "" : ` (${(a.rate * 100).toFixed(1)}%)`}`;
  const ms = (v: number | null) => (v === null ? "-" : `${v.toFixed(0)} ms`);
  console.log(`\n== ${options.model}, ${s.calls} calls, ${s.errors} errors`);
  console.log(`accuracy overall:             ${pct(s.accuracy)}`);
  console.log(
    `accuracy excluding borderline: ${pct(s.accuracyExcludingBorderline)}`,
  );
  console.log(`accuracy borderline only:     ${pct(s.accuracyBorderlineOnly)}`);
  console.log("confusion (expected -> chosen):");
  for (const expected of ["ui_only", "needs_tools"] as const) {
    const row = s.confusion[expected];
    console.log(
      `  ${expected.padEnd(11)} -> ui_only ${row.ui_only}, needs_tools ${row.needs_tools}, error ${row.error}`,
    );
  }
  console.log(
    `latency (answered calls): p50 ${ms(s.latencyMs.p50)}, p95 ${ms(s.latencyMs.p95)}, max ${ms(s.latencyMs.max)}`,
  );
  if (s.unstableCases.length > 0)
    console.log(`route changed across repeats: ${s.unstableCases.join(", ")}`);
}

function ratio(records: readonly CallRecord[]) {
  const correct = records.filter((r) => r.correct).length;
  return {
    correct,
    total: records.length,
    rate: records.length === 0 ? null : correct / records.length,
  };
}

// Nearest-rank percentile.
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function loadCases(path: string): RouterCase[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const list = isRecord(parsed) ? parsed.cases : undefined;
  if (!Array.isArray(list)) fail(`${path}: expected { cases: [...] }`);
  const ids = new Set<string>();
  return list.map((item: unknown, index) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !Array.isArray(item.recentConversation) ||
      !item.recentConversation.every(
        (line) => typeof line === "string" && /^(user|assistant): /.test(line),
      ) ||
      item.recentConversation.length > 4 ||
      typeof item.latestRequest !== "string" ||
      (item.expected !== "ui_only" && item.expected !== "needs_tools")
    )
      fail(`${path}: case ${index} is malformed`);
    if (ids.has(item.id)) fail(`${path}: duplicate case id ${item.id}`);
    ids.add(item.id);
    return item as unknown as RouterCase;
  });
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (
      ![
        "--model",
        "--repeats",
        "--out",
        "--cases",
        "--only",
        "--timeout",
      ].includes(flag)
    )
      fail(`unknown flag ${flag}`);
    const value = argv[++i];
    if (value === undefined) fail(`${flag} needs a value`);
    values.set(flag, value);
  }
  const model = values.get("--model");
  if (!model) fail("--model is required, e.g. --model jev-1.14.0");
  const repeats = Number(values.get("--repeats") ?? "1");
  if (!Number.isInteger(repeats) || repeats < 1)
    fail("--repeats must be a positive integer");
  const timeoutMs = Number(
    values.get("--timeout") ?? String(JEV_ROUTER_TIMEOUT_MS),
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    fail("--timeout must be positive");
  const here = dirname(fileURLToPath(import.meta.url));
  const only = values.get("--only");
  return {
    model,
    repeats,
    out: values.get("--out"),
    casesPath: resolve(
      values.get("--cases") ?? resolve(here, "router-cases.json"),
    ),
    only: only ? new Set(only.split(",").map((id) => id.trim())) : undefined,
    timeoutMs,
    dryRun,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(`router-replay: ${message}`);
  process.exit(1);
}
