/**
 * Software factory for the omarchy-package-request web application.
 *
 * Takes a work request and drives it through implement → test → review, each
 * stage writing evidence as versioned data:
 *
 * - `implement`: constrained Claude call (full edit tools + the project's
 *   Next.js/shadcn skills) that completes the work request and reports a
 *   structured WORK.json.
 * - `test`: deterministic — runs the app's `test` and `build` npm scripts.
 * - `review`: bounded critique loop ENFORCED IN CODE: a lower-cost model
 *   reviews the changed files (round 1), only that first-round critique is
 *   fixed, later rounds solely verify the fixes and may flag problems the
 *   fixes themselves introduced. Hard cap: 3 review rounds (so at most 2 fix
 *   passes), then a final verdict.
 *
 * Evidence keying: pass `name` as a work-item key (e.g. wi-001-request-form).
 *
 * @module
 */
// extensions/models/app_factory.ts
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const ImplementSchema = z.object({
  name: z.string(),
  appDir: z.string(),
  request: z.string(),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  model: z.string(),
  numTurns: z.number(),
  durationMs: z.number(),
  costUsd: z.number(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const TestStepSchema = z.object({
  script: z.string(),
  ok: z.boolean(),
  exitCode: z.number(),
  durationMs: z.number(),
});

const TestSchema = z.object({
  name: z.string(),
  appDir: z.string(),
  steps: z.array(TestStepSchema),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  file: z.string(),
  description: z.string(),
  status: z.enum(["open", "addressed"]),
});

const ReviewRoundSchema = z.object({
  name: z.string(),
  round: z.number(),
  model: z.string(),
  verdict: z.string(),
  findings: z.array(FindingSchema),
  costUsd: z.number(),
  timestamp: z.iso.datetime(),
});

const FixRoundSchema = z.object({
  name: z.string(),
  round: z.number(),
  addressed: z.array(z.string()),
  summary: z.string(),
  costUsd: z.number(),
  timestamp: z.iso.datetime(),
});

const ReviewSummarySchema = z.object({
  name: z.string(),
  appDir: z.string(),
  rounds: z.number(),
  fixRounds: z.number(),
  openCritical: z.number(),
  openMajor: z.number(),
  openMinor: z.number(),
  testsPassedAfter: z.boolean(),
  totalCostUsd: z.number(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const WorkArgsSchema = z.object({
  appDir: z.string().describe("Absolute path to the application directory"),
  name: z.string().describe("Work-item evidence key, e.g. wi-001-request-form"),
  request: z.string().describe("The work request: what to build or change, in plain language"),
  model: z.string().default("claude-sonnet-5").describe("Model for the implementation call"),
});
type WorkArgs = z.infer<typeof WorkArgsSchema>;

const TestArgsSchema = z.object({
  appDir: z.string().describe("Absolute path to the application directory"),
  name: z.string().describe("Work-item evidence key"),
});
type TestArgs = z.infer<typeof TestArgsSchema>;

const ReviewArgsSchema = z.object({
  appDir: z.string().describe("Absolute path to the application directory"),
  name: z.string().describe("Work-item evidence key (reads implement-<name> for the change set)"),
  request: z.string().describe("The original work request, for review context"),
  reviewModel: z.string().default("claude-haiku-4-5-20251001").describe(
    "Lower-cost model for the review rounds",
  ),
  fixModel: z.string().default("claude-sonnet-5").describe("Model for the fix passes"),
});
type ReviewArgs = z.infer<typeof ReviewArgsSchema>;

interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  output: string;
  missing: boolean;
}

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  try {
    const proc = new Deno.Command(cmd, { args, cwd, env, stdout: "piped", stderr: "piped" });
    const res = await proc.output();
    const stdout = new TextDecoder().decode(res.stdout);
    const stderr = new TextDecoder().decode(res.stderr);
    return { ok: res.code === 0, code: res.code, stdout, stderr, output: stdout + stderr, missing: false };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, code: -1, stdout: "", stderr: `${cmd}: not installed`, output: `${cmd}: not installed`, missing: true };
    }
    throw err;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch { /* absent is fine */ }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

interface ClaudeOutcome {
  ok: boolean;
  numTurns: number;
  costUsd: number;
  stdout: string;
  raw: string;
}

async function runClaude(
  cwd: string,
  model: string,
  systemPrompt: string,
  task: string,
  tools: string[],
): Promise<ClaudeOutcome> {
  const cl = await run("claude", [
    "-p",
    task,
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    ...tools,
    "--permission-mode",
    "acceptEdits",
    "--model",
    model,
    "--output-format",
    "json",
  ], cwd);
  if (cl.missing) throw new Error("claude CLI not installed");
  let numTurns = 0;
  let costUsd = 0;
  let ok = cl.ok;
  try {
    const res = JSON.parse(cl.stdout);
    numTurns = res.num_turns ?? 0;
    costUsd = res.total_cost_usd ?? 0;
    ok = ok && !res.is_error;
  } catch {
    ok = false;
  }
  return { ok, numTurns, costUsd, stdout: cl.stdout, raw: cl.stdout + cl.stderr };
}

const IMPLEMENT_SYSTEM_PROMPT = `You are the implementation stage of a software factory for the omarchy-package-request web application (Next.js + shadcn/ui + TypeScript).

Complete the work request in the current working directory (the app root).

Rules:
- Follow the project's existing patterns and file layout.
- For UI work use shadcn/ui components; the 'shadcn' skill is available via the Skill tool — use it when adding or composing components. Next.js skills (next-dev-loop etc.) are likewise available when useful.
- Keep the work scoped to the request. No drive-by refactors.
- Before finishing: run the test suite if one exists (npm test) and the production build (npm run build), and fix any failures. The factory re-runs both after you — they must pass.
- When done, write WORK.json in the app root with EXACTLY this shape:
  { "summary": "<what you did and key decisions>", "filesChanged": ["relative/path", ...], "testsPassed": true|false, "notes": "<anything the reviewer should know>" }`;

const REVIEW_SYSTEM_PROMPT = `You are the review stage of a software factory. You review ONLY — never modify the application. Your Bash access is restricted to commands that start with the word "swamp" (the CLI is on PATH); npm, npx, tsc, cd or any other command will be DENIED — do not attempt them, and do not prefix the swamp command with cd or a path.

Review the changed files against the work request. Be focused and proportionate: report real problems (correctness, security, broken flows, misuse of framework APIs), not style preferences or hypothetical improvements.

When done, record your verdict by running the swamp command given in the task EXACTLY as written, from the current directory, substituting only the payload. The payload must be EXACTLY this shape (one JSON object, single-quoted in the shell):
{ "verdict": "approve" | "request_changes", "findings": [ { "id": "F1", "severity": "critical" | "major" | "minor", "file": "relative/path", "description": "<the problem and why it matters>" } ] }
If the record command reports a payload error, correct the JSON and run it again. Recording the verdict is the last thing you do — your task is not complete until the record command has succeeded.`;

const FIX_SYSTEM_PROMPT = `You are the fix stage of a software factory. Address ONLY the review findings given in the task — nothing else. No refactors, no improvements beyond the findings. After fixing, re-run the test suite (npm test, if present) and the production build (npm run build) and make them pass.

When done, record your fix report by running the swamp command given in the task. The payload must be EXACTLY this shape:
{ "addressed": ["F1", "F2"], "summary": "<what you changed per finding>" }
If the record command reports a payload error, correct the JSON and run it again. Recording the report is the last thing you do.`;

type Finding = z.infer<typeof FindingSchema>;

function findingsFromObject(
  parsed: Record<string, unknown>,
): { verdict: string; findings: Finding[] } {
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = rawFindings.map((f: Record<string, unknown>, i: number) => ({
    id: String(f.id ?? `F${i + 1}`),
    severity: ["critical", "major", "minor"].includes(String(f.severity))
      ? String(f.severity) as Finding["severity"]
      : "minor",
    file: String(f.file ?? ""),
    description: String(f.description ?? ""),
    status: "open" as const,
  }));
  return { verdict: String(parsed.verdict ?? "request_changes"), findings };
}

/** Parse a verdict object out of arbitrary text (bare JSON or JSON inside prose/fences). */
function parseVerdictText(text: string): { verdict: string; findings: Finding[] } | null {
  if (!text) return null;
  try {
    return findingsFromObject(JSON.parse(text));
  } catch { /* fall through to extraction */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return findingsFromObject(JSON.parse(match[0]));
  } catch {
    return null;
  }
}

/** Fallback when REVIEW.json is missing: fish a JSON verdict out of the model's final message. */
function parseFindings(stdout: string): { verdict: string; findings: Finding[] } | null {
  try {
    const envelope = JSON.parse(stdout);
    return parseVerdictText(String(envelope.result ?? ""));
  } catch {
    return null;
  }
}

/** The exact CLI command a child runs to record structured stage output into swamp. */
function recordCommand(repoDir: string, kind: string, key: string, nonce: string): string {
  return `swamp model @omarchy/stage-output method run record stage-output --repo-dir ${repoDir} --input kind=${kind} --input key=${key} --input nonce=${nonce} --input 'payload=<YOUR JSON OBJECT>'`;
}

/** Read back a child's stage-output record, accepting it only if the nonce matches this invocation. */
async function readStageRecord(
  repoDir: string,
  kind: string,
  key: string,
  nonce: string,
): Promise<Record<string, unknown> | null> {
  const res = await run("swamp", [
    "data",
    "get",
    "stage-output",
    `record-${kind}-${key}`,
    "--json",
    "--repo-dir",
    repoDir,
  ]);
  if (!res.ok) return null;
  try {
    const content = JSON.parse(res.stdout).content;
    if (content?.nonce !== nonce) return null;
    return content.payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runTests(
  appDir: string,
): Promise<{ steps: z.infer<typeof TestStepSchema>[]; passed: boolean; log: string }> {
  const pkg = await readJsonFile(`${appDir}/package.json`);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const toRun = ["test", "build"].filter((s) => s in scripts);
  const steps: z.infer<typeof TestStepSchema>[] = [];
  const logs: string[] = [];
  for (const script of toRun) {
    const started = Date.now();
    const res = await run("npm", ["run", script, "--silent"], appDir, { CI: "1" });
    steps.push({ script, ok: res.ok, exitCode: res.code, durationMs: Date.now() - started });
    logs.push(`$ npm run ${script} (exit ${res.code})\n${res.output}`);
  }
  return {
    steps,
    passed: toRun.length > 0 && steps.every((s) => s.ok),
    log: logs.join("\n\n") || "no test or build scripts in package.json",
  };
}

type WriteResourceFn = (
  specName: string,
  name: string,
  data: Record<string, unknown>,
) => Promise<{ name: string }>;
type FileWriterFn = (
  specName: string,
  name: string,
) => { writeText: (text: string) => Promise<{ name: string }> };
type Logger = { info: (msg: string, props?: Record<string, unknown>) => void };

/** Software factory for the package-request web app: implement, test, and review work requests with evidence. */
export const model = {
  type: "@omarchy/app-factory",
  version: "2026.09.03.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "implement": {
      description: "Implementation evidence (instance per work item: implement-<name>)",
      schema: ImplementSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "test": {
      description: "Test/build run evidence (instance per work item: test-<name>)",
      schema: TestSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "reviewRound": {
      description: "One review round's findings (instance: reviewround-<name>-r<N>)",
      schema: ReviewRoundSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "fixRound": {
      description: "One fix pass (instance: fixround-<name>-r<N>)",
      schema: FixRoundSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "review": {
      description: "Final review verdict for a work item (instance: review-<name>)",
      schema: ReviewSummarySchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  files: {
    "log": {
      description: "Raw tool/model output for a factory stage",
      contentType: "text/plain",
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    implement: {
      description:
        "Complete a work request via a Claude call with edit tools and the project's Next.js/shadcn skills",
      arguments: WorkArgsSchema,
      execute: async (
        args: WorkArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        await Deno.stat(`${args.appDir}/package.json`).catch(() => {
          throw new Error(`${args.appDir} is not an app directory (no package.json)`);
        });
        await removeIfExists(`${args.appDir}/WORK.json`);

        const started = Date.now();
        const cl = await runClaude(
          args.appDir,
          args.model,
          IMPLEMENT_SYSTEM_PROMPT,
          `Work request (evidence key ${args.name}):\n\n${args.request}`,
          ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill", "TodoWrite"],
        );
        const durationMs = Date.now() - started;
        const work = await readJsonFile(`${args.appDir}/WORK.json`);
        const passed = cl.ok && work !== null;
        context.logger.info("implement {name}: passed={passed} cost={cost}", {
          name: args.name,
          passed,
          cost: cl.costUsd,
        });

        const logHandle = await context.createFileWriter("log", `implementlog-${args.name}`)
          .writeText(`# request\n${args.request}\n\n# claude output\n${cl.raw}`);
        const handle = await context.writeResource("implement", `implement-${args.name}`, {
          name: args.name,
          appDir: args.appDir,
          request: args.request,
          summary: String(work?.summary ?? ""),
          filesChanged: Array.isArray(work?.filesChanged) ? work.filesChanged.map(String) : [],
          model: args.model,
          numTurns: cl.numTurns,
          durationMs,
          costUsd: cl.costUsd,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    test: {
      description: "Run the app's test and build npm scripts (deterministic verification)",
      arguments: TestArgsSchema,
      execute: async (
        args: TestArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        const { steps, passed, log } = await runTests(args.appDir);
        context.logger.info("test {name}: passed={passed}", { name: args.name, passed });
        const logHandle = await context.createFileWriter("log", `testlog-${args.name}`)
          .writeText(log);
        const handle = await context.writeResource("test", `test-${args.name}`, {
          name: args.name,
          appDir: args.appDir,
          steps,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    review: {
      description:
        "Bounded review loop: lower-model critique (round 1), fix only that critique, later rounds verify fixes and flag only fix-introduced problems; max 3 review rounds",
      arguments: ReviewArgsSchema,
      execute: async (
        args: ReviewArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          repoDir: string;
          readResource: (name: string) => Promise<Record<string, unknown> | null>;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        const impl = await context.readResource(`implement-${args.name}`) as
          | z.infer<typeof ImplementSchema>
          | null;
        if (!impl) {
          throw new Error(`No implement-${args.name} evidence — run implement first`);
        }
        const filesChanged = impl.filesChanged.length
          ? impl.filesChanged.join("\n")
          : "(implementation did not report files — review the app's src/ and app/ directories)";

        const handles: Array<{ name: string }> = [];
        const logs: string[] = [];
        let totalCostUsd = 0;
        let open: Finding[] = [];
        let allMinor: Finding[] = [];
        let rounds = 0;
        let fixRounds = 0;
        let finalRoundParsed = false;

        for (let round = 1; round <= 3; round++) {
          rounds = round;
          const nonce = crypto.randomUUID().slice(0, 8);
          const recordCmd = recordCommand(context.repoDir, "review", `${args.name}-r${round}`, nonce);
          const task = (round === 1
            ? `Work request:\n${args.request}\n\nFiles changed by the implementation:\n${filesChanged}\n\nImplementation summary: ${impl.summary}\n\nReview the changed files (round 1 of at most 3).`
            : `Work request:\n${args.request}\n\nFiles changed by the implementation:\n${filesChanged}\n\nThis is verification round ${round}. These findings from round 1 were just fixed:\n${
              JSON.stringify(open.map((f) => ({ id: f.id, file: f.file, description: f.description })), null, 2)
            }\n\nReport ONLY: (a) listed findings that are still not addressed, (b) new problems directly introduced by the fixes. Do NOT report pre-existing or unrelated issues — this is not a fresh review.`) +
            `\n\nRecord your verdict by running this EXACTLY as written (no cd, no path prefix; only the payload placeholder changes):\n${recordCmd}`;

          const rv = await runClaude(
            args.appDir,
            args.reviewModel,
            REVIEW_SYSTEM_PROMPT,
            task,
            ["Read", "Glob", "Grep", "Bash(swamp:*)"],
          );
          totalCostUsd += rv.costUsd;
          logs.push(`# review round ${round}\n${rv.raw}`);
          const record = await readStageRecord(context.repoDir, "review", `${args.name}-r${round}`, nonce);
          const parsed = record ? findingsFromObject(record) : parseFindings(rv.stdout);
          finalRoundParsed = parsed !== null;
          const findings = parsed?.findings ?? [];
          handles.push(
            await context.writeResource("reviewRound", `reviewround-${args.name}-r${round}`, {
              name: args.name,
              round,
              model: args.reviewModel,
              verdict: parsed?.verdict ?? "unparseable",
              findings,
              costUsd: rv.costUsd,
              timestamp: new Date().toISOString(),
            }),
          );
          allMinor = [...allMinor, ...findings.filter((f) => f.severity === "minor")];
          open = findings.filter((f) => f.severity !== "minor");
          context.logger.info("review {name} r{round}: {n} blocking findings", {
            name: args.name,
            round,
            n: open.length,
          });

          if (open.length === 0 || round === 3) break;

          // Fix pass: address ONLY the current blocking findings.
          fixRounds++;
          const fixNonce = crypto.randomUUID().slice(0, 8);
          const fixCmd = recordCommand(context.repoDir, "fix", `${args.name}-r${fixRounds}`, fixNonce);
          const fx = await runClaude(
            args.appDir,
            args.fixModel,
            FIX_SYSTEM_PROMPT,
            `Address these review findings, and only these:\n${
              JSON.stringify(open.map((f) => ({ id: f.id, severity: f.severity, file: f.file, description: f.description })), null, 2)
            }\n\nRecord your fix report with:\n${fixCmd}`,
            ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"],
          );
          totalCostUsd += fx.costUsd;
          logs.push(`# fix round ${fixRounds}\n${fx.raw}`);
          const fix = await readStageRecord(context.repoDir, "fix", `${args.name}-r${fixRounds}`, fixNonce);
          handles.push(
            await context.writeResource("fixRound", `fixround-${args.name}-r${fixRounds}`, {
              name: args.name,
              round: fixRounds,
              addressed: Array.isArray(fix?.addressed) ? fix.addressed.map(String) : [],
              summary: String(fix?.summary ?? "fix report not recorded"),
              costUsd: fx.costUsd,
              timestamp: new Date().toISOString(),
            }),
          );
        }

        // Deterministic re-verification after any fixes.
        const { passed: testsPassedAfter, log: testLog } = await runTests(args.appDir);
        logs.push(`# tests after review loop\n${testLog}`);

        const openCritical = open.filter((f) => f.severity === "critical").length;
        const openMajor = open.filter((f) => f.severity === "major").length;
        // Fail closed: a review whose final round could not be parsed proves nothing.
        const passed = finalRoundParsed && openCritical === 0 && openMajor === 0 && testsPassedAfter;
        context.logger.info(
          "review {name}: rounds={rounds} fixes={fixRounds} passed={passed}",
          { name: args.name, rounds, fixRounds, passed },
        );

        const logHandle = await context.createFileWriter("log", `reviewlog-${args.name}`)
          .writeText(logs.join("\n\n"));
        const handle = await context.writeResource("review", `review-${args.name}`, {
          name: args.name,
          appDir: args.appDir,
          rounds,
          fixRounds,
          openCritical,
          openMajor,
          openMinor: allMinor.length,
          testsPassedAfter,
          totalCostUsd,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, ...handles, logHandle] };
      },
    },
  },
};
