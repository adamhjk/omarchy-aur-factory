import { execFile, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"

/**
 * Thin wrapper around the `swamp` CLI for the @omarchy/package-request model.
 *
 * All calls go through `execFile` with argv arrays -- never a shell -- so
 * user-supplied values (pkgname, url, description, etc.) can never be
 * interpreted as shell syntax.
 */

export const SWAMP_DIR =
  process.env.SWAMP_DIR || "/home/adam/src/omarchy-aur-factory/swamp"

/** Where built packages land, passed as the create-package workflow's `dir` input. */
export const PACKAGES_DIR =
  process.env.PACKAGES_DIR || "/home/adam/src/omarchy-aur-factory/test-packages"

/** Scratch workdir for in-progress builds, passed as the workflow's `workdir` input. */
export const BUILD_SCRATCH_DIR =
  process.env.BUILD_SCRATCH_DIR || "/tmp/omarchy-factory-scratch"

const SWAMP_BIN = "swamp"
const MODEL_TYPE = "@omarchy/package-request"
const MODEL_NAME = "requests"

export type ApprovalRecord = { by: string; at: string } | null

export interface HistoryEntry {
  at: string
  event: string
  by: string
  detail: string
}

export type RequestStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "unstable"
  | "stable"

export interface PackageRequest {
  pkgname: string
  url: string
  description: string
  license: string
  status: RequestStatus
  submittedBy: string
  version: string
  maintainerApproval: ApprovalRecord
  promotionMaintainer: ApprovalRecord
  promotionUser: ApprovalRecord
  rejectionReason: string
  history: HistoryEntry[]
  updatedAt: string
}

export interface SubmitInput {
  pkgname: string
  url: string
  description: string
  license: string
  submitter: string
}

export type RulingAction = "approve" | "reject"
export type PromotionRole = "maintainer" | "user"

/** Error surfaced by the swamp CLI, parsed from its stderr JSON envelope. */
export class SwampCliError extends Error {
  /** Machine-readable error code from swamp (e.g. "method_execution_failed"). */
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "SwampCliError"
    this.code = code
  }
}

interface ExecFileError {
  message?: string
}

/** Runs `swamp <args>` and returns raw stdout, or throws a SwampCliError. */
function runSwamp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      SWAMP_BIN,
      args,
      { cwd: SWAMP_DIR, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(parseCliError(stderr, error as ExecFileError))
          return
        }
        resolve(stdout)
      }
    )
  })
}

/** Parses swamp's `--json` stderr error envelope: {"error": "...", "code": "..."}. */
function parseCliError(stderr: string, fallback: ExecFileError): SwampCliError {
  const text = (stderr ?? "").trim()
  if (text) {
    try {
      const envelope = JSON.parse(text) as { error?: string; code?: string }
      if (envelope && typeof envelope.error === "string") {
        return new SwampCliError(envelope.error, envelope.code)
      }
    } catch {
      // stderr wasn't the JSON envelope; fall through to the generic message.
    }
  }
  return new SwampCliError(fallback.message ?? "swamp CLI failed")
}

async function runSwampJson(args: string[]): Promise<unknown> {
  const stdout = await runSwamp([...args, "--json"])
  const trimmed = stdout.trim()
  return trimmed ? JSON.parse(trimmed) : null
}

interface QueryResult {
  results?: Array<{ content?: PackageRequest }>
}

/** GET /api/requests backing query: all latest package-request rows. */
export async function queryRequests(): Promise<PackageRequest[]> {
  const result = (await runSwampJson([
    "data",
    "query",
    'name.startsWith("request-") && isLatest',
  ])) as QueryResult

  return (result?.results ?? [])
    .map((row) => row.content)
    .filter((content): content is PackageRequest => Boolean(content))
}

/** GET /api/requests/[pkgname]/report backing lookup: a single request's latest row. */
export async function getRequest(pkgname: string): Promise<PackageRequest | null> {
  const result = (await runSwampJson([
    "data",
    "query",
    `name == ${celString(`request-${pkgname}`)} && isLatest`,
  ])) as QueryResult

  return result?.results?.[0]?.content ?? null
}

interface MethodRunResult {
  dataArtifacts?: Array<{ name: string; attributes: PackageRequest }>
}

function extractRequest(result: MethodRunResult): PackageRequest {
  const artifact = result.dataArtifacts?.[0]
  if (!artifact) {
    throw new SwampCliError("swamp did not return the expected request data")
  }
  return artifact.attributes
}

async function runMethod(
  methodName: string,
  inputs: Array<[string, string]>
): Promise<PackageRequest> {
  const args = ["model", "method", "run", MODEL_TYPE, methodName, MODEL_NAME]
  for (const [key, value] of inputs) {
    args.push("--input", `${key}=${value}`)
  }
  const result = (await runSwampJson(args)) as MethodRunResult
  return extractRequest(result)
}

/** File a new package request (status: requested). */
export async function submitRequest(input: SubmitInput): Promise<PackageRequest> {
  return runMethod("submit", [
    ["pkgname", input.pkgname],
    ["url", input.url],
    ["description", input.description],
    ["license", input.license],
    ["submitter", input.submitter],
  ])
}

/** Maintainer approves or rejects a requested package. Reject requires a reason. */
export async function ruleOnRequest(
  pkgname: string,
  approver: string,
  action: RulingAction,
  reason?: string
): Promise<PackageRequest> {
  const inputs: Array<[string, string]> = [
    ["pkgname", pkgname],
    ["approver", approver],
  ]
  if (reason) {
    inputs.push(["reason", reason])
  }
  return runMethod(action, inputs)
}

/**
 * Fire-and-forget kickoff of the create-package build pipeline for a
 * newly-approved request. Spawned detached with ignored stdio and unref'd
 * immediately -- the workflow runs for many minutes and the HTTP response
 * that triggers it must return right away rather than waiting on it.
 *
 * Still goes through an argv array (never a shell), so pkgname/url/
 * description/license can never be interpreted as shell syntax.
 */
export function triggerPackageBuild(
  request: Pick<PackageRequest, "pkgname" | "url" | "description" | "license">,
  hints?: string
): void {
  mkdirSync(PACKAGES_DIR, { recursive: true })
  mkdirSync(BUILD_SCRATCH_DIR, { recursive: true })

  const args = [
    "workflow",
    "run",
    "create-package",
    "--input",
    `pkgname=${request.pkgname}`,
    "--input",
    `url=${request.url}`,
    "--input",
    `description=${request.description}`,
    "--input",
    `license=${request.license}`,
    "--input",
    `dir=${PACKAGES_DIR}/${request.pkgname}`,
    "--input",
    `workdir=${BUILD_SCRATCH_DIR}/${request.pkgname}`,
  ]
  if (hints) {
    args.push("--input", `hints=${hints}`)
  }
  args.push("--json")

  const child = spawn(SWAMP_BIN, args, {
    cwd: SWAMP_DIR,
    detached: true,
    stdio: "ignore",
  })
  // Fire-and-forget: swallow spawn-level errors (e.g. missing binary) rather
  // than letting an unhandled 'error' event crash the server process. The
  // caller has no meaningful way to surface this after the fact anyway.
  child.on("error", () => {})
  child.unref()
}

/**
 * Records a maintainer's build-retry request with hints for the next
 * authoring attempt. Throws (via SwampCliError) when the request doesn't
 * exist or isn't currently 'approved' -- both are conflicts for the caller
 * to surface as 409, not server errors.
 */
export async function recordRetry(
  pkgname: string,
  requestedBy: string,
  hint: string
): Promise<PackageRequest> {
  return runMethod("record-retry", [
    ["pkgname", pkgname],
    ["requestedBy", requestedBy],
    ["hint", hint],
  ])
}

/** Records a maintainer or user promotion approval; both present -> stable. */
export async function approvePromotion(
  pkgname: string,
  approver: string,
  role: PromotionRole
): Promise<PackageRequest> {
  return runMethod("approve-promotion", [
    ["pkgname", pkgname],
    ["approver", approver],
    ["role", role],
  ])
}

// -- Build status (GET /api/requests/[pkgname]/build-status) --------------

export interface BuildRunSummary {
  runId: string
  status: string
  startedAt: string
  stepProgress: { completed: number; total: number }
}

export interface BuildStepDetail {
  job: string
  name: string
  status: string
  duration?: number
}

/** A single dossier pipeline stage's summary (shape varies per stage). */
export interface DossierStage {
  passed?: boolean
  [key: string]: unknown
}

/** JSON body of the @omarchy/package-dossier report. */
export interface PackageDossierJson {
  pkgname: string
  version?: string
  workflowName?: string
  workflowRunId: string
  workflowStatus?: string
  stages: Record<string, DossierStage | null>
  notes: Array<{ stage: string; notes: string }>
}

export interface BuildStatus {
  building: boolean
  run: BuildRunSummary | null
  steps: BuildStepDetail[] | null
  dossier: { json: PackageDossierJson; markdown: string } | null
}

/** Run statuses that mean the workflow is no longer in progress. */
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled", "canceled"])

interface RawWorkflowRun {
  runId: string
  status: string
  startedAt: string
  stepProgress?: { completed: number; total: number }
  inputs?: Record<string, unknown>
}

interface WorkflowSearchResult {
  results?: RawWorkflowRun[]
}

interface RawWorkflowStep {
  name: string
  status: string
  duration?: number
}

interface RawWorkflowJob {
  name: string
  status: string
  steps?: RawWorkflowStep[]
}

interface WorkflowRunDetail {
  status: string
  jobs?: RawWorkflowJob[]
}

/** Escapes a value for embedding in a CEL double-quoted string literal. */
function celString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

async function searchWorkflowRuns(filter: string): Promise<RawWorkflowRun[]> {
  const result = (await runSwampJson([
    "workflow",
    "history",
    "search",
    "--filter",
    filter,
  ])) as WorkflowSearchResult
  return result?.results ?? []
}

/** Picks the run with the most recent startedAt timestamp (not assumed to be array order). */
function newestRun(runs: RawWorkflowRun[]): RawWorkflowRun | null {
  return runs.reduce<RawWorkflowRun | null>((newest, run) => {
    if (!newest) return run
    return new Date(run.startedAt).getTime() > new Date(newest.startedAt).getTime()
      ? run
      : newest
  }, null)
}

async function getRunDetail(runId: string): Promise<WorkflowRunDetail | null> {
  try {
    return (await runSwampJson(["workflow", "history", "get", runId])) as WorkflowRunDetail
  } catch {
    return null
  }
}

function flattenSteps(detail: WorkflowRunDetail | null): BuildStepDetail[] {
  if (!detail?.jobs) return []
  const steps: BuildStepDetail[] = []
  for (const job of detail.jobs) {
    for (const step of job.steps ?? []) {
      steps.push({ job: job.name, name: step.name, status: step.status, duration: step.duration })
    }
  }
  return steps
}

interface RawDossierGetResult {
  json?: PackageDossierJson
}

/**
 * Fetches the @omarchy/package-dossier report scoped to the create-package
 * workflow, returning it only when its pkgname matches -- another package may
 * have built more recently and left its dossier as the "current" one.
 */
async function fetchMatchingDossier(pkgname: string): Promise<BuildStatus["dossier"]> {
  let dossierJson: PackageDossierJson | undefined
  try {
    const raw = (await runSwampJson([
      "report",
      "get",
      "@omarchy/package-dossier",
      "--workflow",
      "create-package",
    ])) as RawDossierGetResult | null
    dossierJson = raw?.json
  } catch {
    return null
  }

  if (!dossierJson || dossierJson.pkgname !== pkgname) {
    return null
  }

  try {
    const markdown = await runSwamp([
      "report",
      "get",
      "@omarchy/package-dossier",
      "--workflow",
      "create-package",
      "--markdown",
    ])
    return { json: dossierJson, markdown: markdown.trim() }
  } catch {
    return null
  }
}

/**
 * Build/vet pipeline status for a package: the newest create-package run
 * (with step-level detail merged from its nested build-package run), and --
 * once that run has succeeded -- the final package dossier, when present and
 * matching this pkgname.
 */
export async function getBuildStatus(pkgname: string): Promise<BuildStatus> {
  const createRuns = await searchWorkflowRuns(
    `workflowName == "create-package" && inputs.pkgname == ${celString(pkgname)}`
  )
  const newestCreate = newestRun(createRuns)

  if (!newestCreate) {
    return { building: false, run: null, steps: null, dossier: null }
  }

  const createDetail = await getRunDetail(newestCreate.runId)
  let steps = flattenSteps(createDetail)

  const buildRuns = await searchWorkflowRuns(
    `workflowName == "build-package" && inputs.name == ${celString(pkgname)}`
  )
  const newestBuild = newestRun(buildRuns)
  if (newestBuild) {
    const buildDetail = await getRunDetail(newestBuild.runId)
    steps = steps.concat(flattenSteps(buildDetail))
  }

  let dossier: BuildStatus["dossier"] = null
  if (newestCreate.status === "succeeded") {
    dossier = await fetchMatchingDossier(pkgname)
  }

  return {
    building: !TERMINAL_RUN_STATUSES.has(newestCreate.status),
    run: {
      runId: newestCreate.runId,
      status: newestCreate.status,
      startedAt: newestCreate.startedAt,
      stepProgress: newestCreate.stepProgress ?? { completed: 0, total: 0 },
    },
    steps: steps.length > 0 ? steps : null,
    dossier,
  }
}

// -- Build report (GET /api/requests/[pkgname]/report) --------------------

/**
 * Where a BuildReport came from: the full dossier report ('report' -- either
 * still current or recovered from an older workflow-run version), the
 * permanent stage evidence used as a fallback once the dossier has aged out
 * of retention ('evidence'), or nothing found at all (null).
 */
export type BuildReportSource = "report" | "evidence" | null

export interface EvidenceCheckSummary {
  passed: boolean
  failCount: number
  warnCount: number
}

export interface EvidenceBuildSummary {
  durationMs: number
  artifacts: string[]
}

export interface BuildReportEvidence {
  lint: EvidenceCheckSummary | null
  audit: EvidenceCheckSummary | null
  build: EvidenceBuildSummary | null
}

export interface BuildReport {
  source: BuildReportSource
  markdown: string | null
  json: PackageDossierJson | null
  evidence: BuildReportEvidence | null
}

/** How many versions back of the dossier report to search once the newest one belongs to another package. */
const DOSSIER_VERSION_LOOKBACK = 5

/** True when a SwampCliError is the "no such version/data" case that we should skip over, not fail on. */
function isDataNotFoundError(error: unknown): boolean {
  return error instanceof SwampCliError && /data not found/i.test(error.message)
}

/** The dossier JSON's `content` field, whether swamp handed it back as an object or a JSON string. */
function parseDossierContent(content: unknown): PackageDossierJson | null {
  if (content && typeof content === "object") {
    return content as PackageDossierJson
  }
  if (typeof content === "string" && content.trim()) {
    try {
      return JSON.parse(content) as PackageDossierJson
    } catch {
      return null
    }
  }
  return null
}

interface RawDataGetResult {
  version?: number
  content?: unknown
}

/** Fetches the dossier JSON's raw `data get` row at a specific report version, tolerating "not found". */
async function getDossierJsonRow(version?: number): Promise<RawDataGetResult | null> {
  const args = [
    "data",
    "get",
    "--workflow",
    "create-package",
    "report-omarchy-package-dossier-json",
  ]
  if (version !== undefined) {
    args.push("--version", String(version))
  }
  try {
    return (await runSwampJson(args)) as RawDataGetResult | null
  } catch (error) {
    if (isDataNotFoundError(error)) return null
    throw error
  }
}

/** Fetches the dossier markdown's raw `data get` row at a specific report version, tolerating "not found". */
async function getDossierMarkdownRow(version: number): Promise<string | null> {
  try {
    const result = (await runSwampJson([
      "data",
      "get",
      "--workflow",
      "create-package",
      "report-omarchy-package-dossier",
      "--version",
      String(version),
    ])) as RawDataGetResult | null
    return typeof result?.content === "string" ? result.content.trim() : null
  } catch (error) {
    if (isDataNotFoundError(error)) return null
    throw error
  }
}

/**
 * Walks the @omarchy/package-dossier report's version history looking for
 * this package's dossier: the "current" (latest) one belongs to whichever
 * package built most recently, so once that's a mismatch we have to search
 * backwards through up to DOSSIER_VERSION_LOOKBACK older versions -- each of
 * which was the "current" dossier at some earlier point -- for one whose
 * pkgname matches. Reports age out (30-day/5-version retention), so missing
 * versions are expected and simply skipped.
 */
async function walkDossierVersions(
  pkgname: string
): Promise<{ json: PackageDossierJson; markdown: string } | null> {
  const latestRow = await getDossierJsonRow()
  const latestVersion = latestRow?.version
  if (typeof latestVersion !== "number") return null

  const floor = Math.max(latestVersion - DOSSIER_VERSION_LOOKBACK, 1)
  for (let version = latestVersion - 1; version >= floor; version--) {
    const row = await getDossierJsonRow(version)
    const json = parseDossierContent(row?.content)
    if (!json || json.pkgname !== pkgname) continue

    const markdown = await getDossierMarkdownRow(version)
    if (markdown === null) continue

    return { json, markdown }
  }
  return null
}

/** Reads one packager evidence field (e.g. `lint-entr-5.8-1`), tolerating "not found". */
async function getEvidenceField<T>(
  dataName: string,
  pick: (content: Record<string, unknown>) => T
): Promise<T | null> {
  try {
    const result = (await runSwampJson(["data", "get", "packager", dataName])) as {
      content?: Record<string, unknown>
    } | null
    if (!result?.content) return null
    return pick(result.content)
  } catch (error) {
    if (isDataNotFoundError(error)) return null
    throw error
  }
}

// -- Per-phase evidence (GET /api/requests/[pkgname]/evidence) ------------

/** A single packager pipeline stage, as exposed by the evidence endpoint. */
export type EvidenceStage = "analysis" | "author" | "checksums" | "build" | "lint" | "audit"

const EVIDENCE_STAGES: ReadonlySet<string> = new Set([
  "analysis",
  "author",
  "checksums",
  "build",
  "lint",
  "audit",
])

export function isEvidenceStage(value: string): value is EvidenceStage {
  return EVIDENCE_STAGES.has(value)
}

/** Stages keyed by the bare pkgname (they run before a version is known). */
const BARE_KEY_STAGES: ReadonlySet<EvidenceStage> = new Set(["analysis", "author"])

/** Raw log data-name prefix for each stage. */
const LOG_PREFIX: Record<EvidenceStage, string> = {
  analysis: "analyzelog",
  author: "authorlog",
  checksums: "checksumslog",
  build: "buildlog",
  lint: "lintlog",
  audit: "auditlog",
}

export interface StageEvidence {
  stage: EvidenceStage
  evidence: Record<string, unknown> | null
  log: string | null
}

/**
 * Resolves the packager evidence version for a package: the request's
 * recorded built version when set (a package that has actually built), else
 * the version the `author` stage recorded (may be null if authoring never
 * ran, e.g. a request that hasn't been approved yet).
 */
export async function resolveEvidenceVersion(
  pkgname: string,
  request: Pick<PackageRequest, "version"> | null
): Promise<string | null> {
  if (request?.version) return request.version
  return getEvidenceField(`author-${pkgname}`, (content) =>
    typeof content.version === "string" && content.version ? content.version : null
  )
}

/** Evidence key for a packager pipeline stage, or null when it can't be constructed. */
function evidenceKey(stage: EvidenceStage, pkgname: string, version: string | null): string | null {
  if (BARE_KEY_STAGES.has(stage)) return pkgname
  return version ? `${pkgname}-${version}` : null
}

/** Reads one stage's raw log file content, tolerating "not found". */
async function getEvidenceLog(dataName: string): Promise<string | null> {
  try {
    const result = (await runSwampJson(["data", "get", "packager", dataName])) as RawDataGetResult | null
    return typeof result?.content === "string" ? result.content : null
  } catch (error) {
    if (isDataNotFoundError(error)) return null
    throw error
  }
}

/**
 * Structured evidence and raw log for one packager pipeline stage. Analysis
 * and author are keyed by the bare pkgname; checksums/build/lint/audit are
 * keyed `<pkgname>-<version>`, so a null version (authoring hasn't run yet)
 * simply yields nulls rather than a malformed data name.
 */
export async function getStageEvidence(
  pkgname: string,
  stage: EvidenceStage,
  version: string | null
): Promise<StageEvidence> {
  const key = evidenceKey(stage, pkgname, version)
  if (!key) return { stage, evidence: null, log: null }

  const evidence = await getEvidenceField(`${stage}-${key}`, (content) => content)
  const log = await getEvidenceLog(`${LOG_PREFIX[stage]}-${key}`)
  return { stage, evidence, log }
}

// -- Durable per-package dossier -------------------------------------------

/**
 * The `dossier-<pkgname>-<version>` snapshot the packager pipeline's
 * `finalize` job writes on every run (success or failure) with infinite
 * lifetime -- unlike the `@omarchy/package-dossier` report, this never ages
 * out and exists for failed builds too. Tolerates "not found" (e.g. a
 * request that hasn't built yet).
 */
export async function getDurableDossier(pkgname: string, version: string): Promise<string | null> {
  try {
    const result = (await runSwampJson([
      "data",
      "get",
      "packager",
      `dossier-${pkgname}-${version}`,
    ])) as RawDataGetResult | null
    return typeof result?.content === "string" ? result.content : null
  } catch (error) {
    if (isDataNotFoundError(error)) return null
    throw error
  }
}

/**
 * Fallback for once the dossier report itself has aged out of retention:
 * reassembles a summary from the permanent lint/audit/build stage evidence
 * recorded on the packager model under `<pkgname>-<version>`.
 */
async function getEvidenceFallback(pkgname: string, version: string): Promise<BuildReportEvidence> {
  const key = `${pkgname}-${version}`
  const pickCheckSummary = (content: Record<string, unknown>): EvidenceCheckSummary => ({
    passed: Boolean(content.passed),
    failCount: Number(content.failCount ?? 0),
    warnCount: Number(content.warnCount ?? 0),
  })

  const lint = await getEvidenceField(`lint-${key}`, pickCheckSummary)
  const audit = await getEvidenceField(`audit-${key}`, pickCheckSummary)
  const build = await getEvidenceField(`build-${key}`, (content) => ({
    durationMs: Number(content.durationMs ?? 0),
    artifacts: Array.isArray(content.artifacts) ? (content.artifacts as string[]) : [],
  }))

  return { lint, audit, build }
}

/**
 * Build report for a package that has already built (status 'unstable' or
 * 'stable'): the full @omarchy/package-dossier report when it -- or an older
 * version of it -- still matches this pkgname, else a compact summary
 * reassembled from the permanent stage evidence once the report itself has
 * aged out of retention.
 */
export async function getBuildReport(pkgname: string, version: string): Promise<BuildReport> {
  try {
    const raw = (await runSwampJson([
      "report",
      "get",
      "@omarchy/package-dossier",
      "--workflow",
      "create-package",
    ])) as RawDossierGetResult | null

    if (raw?.json && raw.json.pkgname === pkgname) {
      const markdown = await runSwamp([
        "report",
        "get",
        "@omarchy/package-dossier",
        "--workflow",
        "create-package",
        "--markdown",
      ])
      return { source: "report", markdown: markdown.trim(), json: raw.json, evidence: null }
    }
  } catch {
    // Fall through to the version walk / evidence fallback below.
  }

  const walked = await walkDossierVersions(pkgname)
  if (walked) {
    return { source: "report", markdown: walked.markdown, json: walked.json, evidence: null }
  }

  const evidence = await getEvidenceFallback(pkgname, version)
  if (evidence.lint || evidence.audit || evidence.build) {
    return { source: "evidence", markdown: null, json: null, evidence }
  }

  return { source: null, markdown: null, json: null, evidence: null }
}
