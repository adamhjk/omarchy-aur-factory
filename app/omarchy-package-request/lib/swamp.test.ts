import { execFile, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}))

import {
  BUILD_SCRATCH_DIR,
  PACKAGES_DIR,
  SWAMP_DIR,
  SwampCliError,
  approvePromotion,
  getBuildReport,
  getBuildStatus,
  getDurableDossier,
  getRequest,
  getStageEvidence,
  queryRequests,
  recordRetry,
  resolveEvidenceVersion,
  ruleOnRequest,
  submitRequest,
  triggerPackageBuild,
} from "./swamp"

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void

const mockedExecFile = vi.mocked(execFile)
const mockedSpawn = vi.mocked(spawn)
const mockedMkdirSync = vi.mocked(mkdirSync)

/** Configures the next execFile call to invoke its callback with the given result. */
function mockExecFileOnce(stdout: string, stderr = "", error: Error | null = null) {
  mockedExecFile.mockImplementationOnce((..._args: unknown[]) => {
    const callback = _args[_args.length - 1] as ExecFileCallback
    callback(error, stdout, stderr)
    return {} as ReturnType<typeof execFile>
  })
}

beforeEach(() => {
  mockedExecFile.mockReset()
  mockedSpawn.mockReset()
  mockedMkdirSync.mockReset()
  mockedSpawn.mockReturnValue({
    on: vi.fn(),
    unref: vi.fn(),
  } as unknown as ReturnType<typeof spawn>)
})

describe("queryRequests", () => {
  it("parses query rows into their .content request objects", async () => {
    const requestA = {
      pkgname: "foo",
      url: "https://example.com/foo",
      description: "Foo package",
      license: "MIT",
      status: "requested",
      submittedBy: "adam",
      version: "",
      maintainerApproval: null,
      promotionMaintainer: null,
      promotionUser: null,
      rejectionReason: "",
      history: [],
      updatedAt: "2026-09-03T00:00:00.000Z",
    }
    mockExecFileOnce(
      JSON.stringify({
        results: [{ content: requestA }, { content: null }],
      })
    )

    const result = await queryRequests()

    expect(result).toEqual([requestA])
  })

  it("invokes swamp with the expected argv and cwd, and no shell", async () => {
    mockExecFileOnce(JSON.stringify({ results: [] }))

    await queryRequests()

    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    const [bin, args, options] = mockedExecFile.mock.calls[0]
    expect(bin).toBe("swamp")
    expect(args).toEqual([
      "data",
      "query",
      'name.startsWith("request-") && isLatest',
      "--json",
    ])
    expect(options).toMatchObject({ cwd: SWAMP_DIR })
    expect(options).not.toHaveProperty("shell")
  })

  it("returns an empty array when there are no results", async () => {
    mockExecFileOnce(JSON.stringify({ results: [] }))

    await expect(queryRequests()).resolves.toEqual([])
  })
})

describe("submitRequest argv construction", () => {
  it("passes each field through argv as a discrete --input element, never shell-interpolated", async () => {
    // A value crafted to look like a shell-injection attempt. Because execFile
    // is called without a shell, this can only ever be a literal argv string --
    // never re-parsed or executed.
    const maliciousPkgname = "pkg`rm -rf /`; echo pwned && cat /etc/passwd"

    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [
          {
            name: `request-${maliciousPkgname}`,
            attributes: { pkgname: maliciousPkgname, status: "requested" },
          },
        ],
      })
    )

    await submitRequest({
      pkgname: maliciousPkgname,
      url: "https://example.com/pkg.tar.gz",
      description: "A package",
      license: "MIT",
      submitter: "adam",
    })

    const [bin, args, options] = mockedExecFile.mock.calls[0]
    expect(bin).toBe("swamp")
    expect(args).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "submit",
      "requests",
      "--input",
      `pkgname=${maliciousPkgname}`,
      "--input",
      "url=https://example.com/pkg.tar.gz",
      "--input",
      "description=A package",
      "--input",
      "license=MIT",
      "--input",
      "submitter=adam",
      "--json",
    ])
    // Each --input value is its own argv array element (never joined into a
    // single shell string), and no shell is requested.
    expect(Array.isArray(args)).toBe(true)
    expect(options).not.toHaveProperty("shell")
  })

  it("resolves with the request attributes from the first data artifact", async () => {
    const attributes = { pkgname: "foo", status: "requested" }
    mockExecFileOnce(
      JSON.stringify({ dataArtifacts: [{ name: "request-foo", attributes }] })
    )

    const result = await submitRequest({
      pkgname: "foo",
      url: "https://example.com",
      description: "d",
      license: "MIT",
      submitter: "adam",
    })

    expect(result).toEqual(attributes)
  })

  it("throws SwampCliError when swamp returns no data artifacts", async () => {
    mockExecFileOnce(JSON.stringify({ dataArtifacts: [] }))

    await expect(
      submitRequest({
        pkgname: "foo",
        url: "https://example.com",
        description: "d",
        license: "MIT",
        submitter: "adam",
      })
    ).rejects.toThrow(SwampCliError)
  })
})

describe("ruleOnRequest argv construction", () => {
  it("omits the reason --input when approving without one", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-foo", attributes: { status: "approved" } }],
      })
    )

    await ruleOnRequest("foo", "maintainer1", "approve")

    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "approve",
      "requests",
      "--input",
      "pkgname=foo",
      "--input",
      "approver=maintainer1",
      "--json",
    ])
  })

  it("includes the reason --input when rejecting with one", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-foo", attributes: { status: "rejected" } }],
      })
    )

    await ruleOnRequest("foo", "maintainer1", "reject", "not maintained upstream")

    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "reject",
      "requests",
      "--input",
      "pkgname=foo",
      "--input",
      "approver=maintainer1",
      "--input",
      "reason=not maintained upstream",
      "--json",
    ])
  })
})

describe("approvePromotion argv construction", () => {
  it("passes pkgname, approver, and role through argv", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-foo", attributes: { status: "unstable" } }],
      })
    )

    await approvePromotion("foo", "user1", "user")

    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "approve-promotion",
      "requests",
      "--input",
      "pkgname=foo",
      "--input",
      "approver=user1",
      "--input",
      "role=user",
      "--json",
    ])
  })
})

describe("triggerPackageBuild", () => {
  it("creates PACKAGES_DIR and BUILD_SCRATCH_DIR, then spawns swamp detached with the correct argv", () => {
    // Values crafted to look like shell-injection attempts. Because spawn is
    // called without a shell, these can only ever be literal argv strings.
    const request = {
      pkgname: "pkg`rm -rf /`",
      url: "https://example.com/pkg.tar.gz; rm -rf /",
      description: "A package && echo pwned",
      license: "MIT",
    }

    triggerPackageBuild(request)

    expect(mockedMkdirSync).toHaveBeenCalledWith(PACKAGES_DIR, { recursive: true })
    expect(mockedMkdirSync).toHaveBeenCalledWith(BUILD_SCRATCH_DIR, { recursive: true })

    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    const [bin, args, options] = mockedSpawn.mock.calls[0]
    expect(bin).toBe("swamp")
    expect(args).toEqual([
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
      "--json",
    ])
    expect(options).toMatchObject({
      cwd: SWAMP_DIR,
      detached: true,
      stdio: "ignore",
    })
    expect(options).not.toHaveProperty("shell")

    const spawned = mockedSpawn.mock.results[0].value as { unref: ReturnType<typeof vi.fn> }
    expect(spawned.unref).toHaveBeenCalledTimes(1)
  })
})

describe("getBuildStatus", () => {
  it("returns {building:false, run:null, steps:null, dossier:null} when no create-package runs exist", async () => {
    mockExecFileOnce(JSON.stringify({ results: [] }))

    const result = await getBuildStatus("foo")

    expect(result).toEqual({ building: false, run: null, steps: null, dossier: null })
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    const [bin, args] = mockedExecFile.mock.calls[0]
    expect(bin).toBe("swamp")
    expect(args).toEqual([
      "workflow",
      "history",
      "search",
      "--filter",
      'workflowName == "create-package" && inputs.pkgname == "foo"',
      "--json",
    ])
  })

  it("selects the newest create-package run by startedAt, not array order", async () => {
    // Newest run ("run-2") sits in the middle of the array -- a naive
    // "first" or "last" pick would get this wrong.
    mockExecFileOnce(
      JSON.stringify({
        results: [
          {
            runId: "run-1",
            status: "succeeded",
            startedAt: "2026-01-01T00:00:00.000Z",
            stepProgress: { completed: 5, total: 5 },
          },
          {
            runId: "run-2",
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z",
            stepProgress: { completed: 2, total: 5 },
          },
          {
            runId: "run-3",
            status: "succeeded",
            startedAt: "2026-02-01T00:00:00.000Z",
            stepProgress: { completed: 5, total: 5 },
          },
        ],
      })
    )
    mockExecFileOnce(
      JSON.stringify({
        status: "running",
        jobs: [
          {
            name: "design",
            status: "running",
            steps: [{ name: "analyze", status: "succeeded", duration: 100 }],
          },
        ],
      })
    )
    mockExecFileOnce(JSON.stringify({ results: [] }))

    const result = await getBuildStatus("entr")

    expect(result.run).toEqual({
      runId: "run-2",
      status: "running",
      startedAt: "2026-03-01T00:00:00.000Z",
      stepProgress: { completed: 2, total: 5 },
    })
    expect(result.building).toBe(true)
    expect(result.steps).toEqual([
      { job: "design", name: "analyze", status: "succeeded", duration: 100 },
    ])
    expect(result.dossier).toBeNull()
    expect(mockedExecFile).toHaveBeenCalledTimes(3)
    // The detail lookup uses the newest run's id, not the first result's.
    const [, detailArgs] = mockedExecFile.mock.calls[1]
    expect(detailArgs).toEqual(["workflow", "history", "get", "run-2", "--json"])
  })

  it("excludes the dossier when its pkgname does not match the requested package", async () => {
    mockExecFileOnce(
      JSON.stringify({
        results: [
          {
            runId: "run-1",
            status: "succeeded",
            startedAt: "2026-01-01T00:00:00.000Z",
            stepProgress: { completed: 5, total: 5 },
          },
        ],
      })
    )
    mockExecFileOnce(
      JSON.stringify({
        status: "succeeded",
        jobs: [{ name: "design", status: "succeeded", steps: [] }],
      })
    )
    mockExecFileOnce(JSON.stringify({ results: [] }))
    // A different, more recently-built package's dossier is the "current" one.
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other-package", workflowRunId: "run-x", stages: {}, notes: [] } })
    )

    const result = await getBuildStatus("entr")

    expect(result.dossier).toBeNull()
    // The markdown fetch must not happen once the pkgname mismatch is known.
    expect(mockedExecFile).toHaveBeenCalledTimes(4)
  })

  it("includes the dossier when its pkgname matches, fetching both json and markdown", async () => {
    mockExecFileOnce(
      JSON.stringify({
        results: [
          {
            runId: "run-1",
            status: "succeeded",
            startedAt: "2026-01-01T00:00:00.000Z",
            stepProgress: { completed: 5, total: 5 },
          },
        ],
      })
    )
    mockExecFileOnce(
      JSON.stringify({
        status: "succeeded",
        jobs: [{ name: "design", status: "succeeded", steps: [] }],
      })
    )
    mockExecFileOnce(JSON.stringify({ results: [] }))
    const dossierJson = {
      pkgname: "entr",
      workflowRunId: "run-1",
      stages: { build: { passed: true } },
      notes: [],
    }
    mockExecFileOnce(JSON.stringify({ json: dossierJson }))
    mockExecFileOnce("# Package Dossier: entr\n")

    const result = await getBuildStatus("entr")

    expect(result.dossier).toEqual({ json: dossierJson, markdown: "# Package Dossier: entr" })
    expect(mockedExecFile).toHaveBeenCalledTimes(5)
    const [, markdownArgs] = mockedExecFile.mock.calls[4]
    expect(markdownArgs).toEqual([
      "report",
      "get",
      "@omarchy/package-dossier",
      "--workflow",
      "create-package",
      "--markdown",
    ])
  })
})

describe("error-envelope handling", () => {
  it("parses swamp's stderr JSON envelope into a SwampCliError", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({
        error: "Request for 'foo' already exists with status 'stable'",
        code: "method_execution_failed",
      }),
      new Error("Command failed with exit code 1")
    )

    await expect(
      submitRequest({
        pkgname: "foo",
        url: "https://example.com",
        description: "d",
        license: "MIT",
        submitter: "adam",
      })
    ).rejects.toMatchObject({
      name: "SwampCliError",
      message: "Request for 'foo' already exists with status 'stable'",
      code: "method_execution_failed",
    })
  })

  it("falls back to the raw execFile error message when stderr isn't a JSON envelope", async () => {
    mockExecFileOnce("", "not json at all", new Error("spawn swamp ENOENT"))

    await expect(queryRequests()).rejects.toMatchObject({
      name: "SwampCliError",
      message: "spawn swamp ENOENT",
    })
  })

  it("falls back to the raw execFile error message when stderr is empty", async () => {
    mockExecFileOnce("", "", new Error("Command failed with exit code 75"))

    await expect(queryRequests()).rejects.toMatchObject({
      name: "SwampCliError",
      message: "Command failed with exit code 75",
    })
  })
})

describe("getRequest", () => {
  it("queries by request name and returns the first result's content", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "foo", status: "stable" } }] })
    )

    const result = await getRequest("foo")

    expect(result).toEqual({ pkgname: "foo", status: "stable" })
    const [bin, args] = mockedExecFile.mock.calls[0]
    expect(bin).toBe("swamp")
    expect(args).toEqual(["data", "query", 'name == "request-foo" && isLatest', "--json"])
  })

  it("returns null when no matching request exists", async () => {
    mockExecFileOnce(JSON.stringify({ results: [] }))

    await expect(getRequest("missing")).resolves.toBeNull()
  })
})

describe("getBuildReport", () => {
  const dossierJsonArgs = [
    "report",
    "get",
    "@omarchy/package-dossier",
    "--workflow",
    "create-package",
    "--json",
  ]
  const dossierMarkdownArgs = [
    "report",
    "get",
    "@omarchy/package-dossier",
    "--workflow",
    "create-package",
    "--markdown",
  ]

  it("returns the current dossier report when its pkgname matches (the just-built race case)", async () => {
    const dossierJson = {
      pkgname: "entr",
      workflowRunId: "run-1",
      stages: { build: { passed: true } },
      notes: [],
    }
    mockExecFileOnce(JSON.stringify({ json: dossierJson }))
    mockExecFileOnce("# Package Dossier: entr\n")

    const result = await getBuildReport("entr", "5.8-1")

    expect(result).toEqual({
      source: "report",
      markdown: "# Package Dossier: entr",
      json: dossierJson,
      evidence: null,
    })
    expect(mockedExecFile).toHaveBeenCalledTimes(2)
    expect(mockedExecFile.mock.calls[0][1]).toEqual(dossierJsonArgs)
    expect(mockedExecFile.mock.calls[1][1]).toEqual(dossierMarkdownArgs)
  })

  it("falls straight to the evidence fallback, fetched in parallel, when the current report belongs to another package", async () => {
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other", workflowRunId: "run-x", stages: {}, notes: [] } })
    )
    mockExecFileOnce(JSON.stringify({ content: { passed: true, failCount: 0, warnCount: 1 } }))
    mockExecFileOnce(JSON.stringify({ content: { passed: false, failCount: 2, warnCount: 0 } }))
    mockExecFileOnce(
      JSON.stringify({
        content: { durationMs: 4321, artifacts: ["entr-5.8-1-x86_64.pkg.tar.zst"] },
      })
    )

    const result = await getBuildReport("entr", "5.8-1")

    expect(result).toEqual({
      source: "evidence",
      markdown: null,
      json: null,
      evidence: {
        lint: { passed: true, failCount: 0, warnCount: 1 },
        audit: { passed: false, failCount: 2, warnCount: 0 },
        build: { durationMs: 4321, artifacts: ["entr-5.8-1-x86_64.pkg.tar.zst"] },
      },
    })
    // No version-walk calls: just the mismatched report lookup, then the
    // three evidence gets -- worst case is 4 calls, well within budget.
    expect(mockedExecFile).toHaveBeenCalledTimes(4)
    expect(mockedExecFile.mock.calls[0][1]).toEqual(dossierJsonArgs)
    const evidenceCalls = mockedExecFile.mock.calls.slice(1).map((call) => call[1])
    expect(evidenceCalls).toContainEqual(["data", "get", "packager", "lint-entr-5.8-1", "--json"])
    expect(evidenceCalls).toContainEqual(["data", "get", "packager", "audit-entr-5.8-1", "--json"])
    expect(evidenceCalls).toContainEqual(["data", "get", "packager", "build-entr-5.8-1", "--json"])
  })

  it("fetches lint/audit/build evidence concurrently: all three calls are issued before any resolves", async () => {
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other", workflowRunId: "run-x", stages: {}, notes: [] } })
    )
    // None of the three evidence calls resolve their callback when invoked --
    // each just parks it in pendingCallbacks. A sequential (await lint, then
    // await audit, then await build) implementation would stall forever
    // after the first call, since nothing ever resolves it, so pendingCallbacks
    // would never grow past 1. Reaching 3 proves all three were issued
    // together via Promise.all.
    const pendingCallbacks: ExecFileCallback[] = []
    mockedExecFile
      .mockImplementationOnce((..._args: unknown[]) => {
        pendingCallbacks.push(_args[_args.length - 1] as ExecFileCallback)
        return {} as ReturnType<typeof execFile>
      })
      .mockImplementationOnce((..._args: unknown[]) => {
        pendingCallbacks.push(_args[_args.length - 1] as ExecFileCallback)
        return {} as ReturnType<typeof execFile>
      })
      .mockImplementationOnce((..._args: unknown[]) => {
        pendingCallbacks.push(_args[_args.length - 1] as ExecFileCallback)
        return {} as ReturnType<typeof execFile>
      })

    const resultPromise = getBuildReport("entr", "5.8-1")

    // Flush microtasks (the report-get call itself resolves a tick late)
    // until all three evidence calls have been issued.
    for (let i = 0; i < 10 && pendingCallbacks.length < 3; i++) {
      await Promise.resolve()
    }
    expect(pendingCallbacks).toHaveLength(3)

    pendingCallbacks[0](null, JSON.stringify({ content: { passed: true } }), "")
    pendingCallbacks[1](null, JSON.stringify({ content: { passed: false } }), "")
    pendingCallbacks[2](null, JSON.stringify({ content: { durationMs: 1, artifacts: [] } }), "")

    const result = await resultPromise

    expect(result.source).toBe("evidence")
    expect(mockedExecFile).toHaveBeenCalledTimes(4)
  })

  it("returns source null when neither the current report nor any evidence is found", async () => {
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other", workflowRunId: "run-x", stages: {}, notes: [] } })
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "lint-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "audit-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "build-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const result = await getBuildReport("entr", "5.8-1")

    expect(result).toEqual({ source: null, markdown: null, json: null, evidence: null })
  })
})

describe("swamp CLI timeout handling", () => {
  it("surfaces a stuck swamp call (killed by the timeout option) as a clear SwampCliError", async () => {
    mockedExecFile.mockImplementationOnce((..._args: unknown[]) => {
      const callback = _args[_args.length - 1] as (
        error: (Error & { killed?: boolean; signal?: string | null }) | null,
        stdout: string,
        stderr: string
      ) => void
      const error = Object.assign(new Error("Command failed"), {
        killed: true,
        signal: "SIGKILL",
      })
      callback(error, "", "")
      return {} as ReturnType<typeof execFile>
    })

    await expect(queryRequests()).rejects.toMatchObject({
      name: "SwampCliError",
      message: "swamp CLI call timed out",
    })
  })

  it("passes timeout and killSignal to execFile so a stuck call can never hang forever", async () => {
    mockExecFileOnce(JSON.stringify({ results: [] }))

    await queryRequests()

    const [, , options] = mockedExecFile.mock.calls[0]
    expect(options).toMatchObject({ timeout: 20_000, killSignal: "SIGKILL" })
  })

  it("does not misreport an ordinary non-zero exit as a timeout", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: "Request for 'foo' already exists", code: "method_execution_failed" }),
      Object.assign(new Error("Command failed with exit code 1"), { killed: false, signal: null })
    )

    await expect(
      submitRequest({
        pkgname: "foo",
        url: "https://example.com",
        description: "d",
        license: "MIT",
        submitter: "adam",
      })
    ).rejects.toMatchObject({
      name: "SwampCliError",
      message: "Request for 'foo' already exists",
    })
  })
})

describe("resolveEvidenceVersion", () => {
  it("uses request.version when set, without consulting the author stage", async () => {
    const version = await resolveEvidenceVersion("entr", { version: "5.8-1" })

    expect(version).toBe("5.8-1")
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it("falls back to the author stage's recorded version when request.version is unset", async () => {
    mockExecFileOnce(JSON.stringify({ content: { version: "5.8-1" } }))

    const version = await resolveEvidenceVersion("entr", { version: "" })

    expect(version).toBe("5.8-1")
    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual(["data", "get", "packager", "author-entr", "--json"])
  })

  it("falls back to null when request.version is unset and authoring never ran", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "author-entr" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const version = await resolveEvidenceVersion("entr", { version: "" })

    expect(version).toBeNull()
  })

  it("falls back to null when there is no request at all", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "author-entr" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const version = await resolveEvidenceVersion("entr", null)

    expect(version).toBeNull()
  })
})

describe("getStageEvidence", () => {
  it("keys 'analysis' by the bare pkgname and reads analysis-<pkgname>/analyzelog-<pkgname>", async () => {
    mockExecFileOnce(JSON.stringify({ content: { name: "entr", passed: true } }))
    mockExecFileOnce(JSON.stringify({ content: "fetched and unpacked" }))

    const result = await getStageEvidence("entr", "analysis", "5.8-1")

    expect(result).toEqual({
      stage: "analysis",
      evidence: { name: "entr", passed: true },
      log: "fetched and unpacked",
    })
    expect(mockedExecFile.mock.calls[0][1]).toEqual([
      "data",
      "get",
      "packager",
      "analysis-entr",
      "--json",
    ])
    expect(mockedExecFile.mock.calls[1][1]).toEqual([
      "data",
      "get",
      "packager",
      "analyzelog-entr",
      "--json",
    ])
  })

  it("keys 'author' by the bare pkgname regardless of the resolved version", async () => {
    mockExecFileOnce(JSON.stringify({ content: { name: "entr", passed: true, rationale: "..." } }))
    mockExecFileOnce(JSON.stringify({ content: "claude output" }))

    await getStageEvidence("entr", "author", "5.8-1")

    expect(mockedExecFile.mock.calls[0][1]).toEqual([
      "data",
      "get",
      "packager",
      "author-entr",
      "--json",
    ])
    expect(mockedExecFile.mock.calls[1][1]).toEqual([
      "data",
      "get",
      "packager",
      "authorlog-entr",
      "--json",
    ])
  })

  it.each([
    ["checksums", "checksumslog"],
    ["build", "buildlog"],
    ["lint", "lintlog"],
    ["audit", "auditlog"],
  ] as const)("keys '%s' by <pkgname>-<version> and reads %s-<key>", async (stage, logPrefix) => {
    mockExecFileOnce(JSON.stringify({ content: { name: "entr-5.8-1", passed: true } }))
    mockExecFileOnce(JSON.stringify({ content: "raw output" }))

    const result = await getStageEvidence("entr", stage, "5.8-1")

    expect(result).toEqual({
      stage,
      evidence: { name: "entr-5.8-1", passed: true },
      log: "raw output",
    })
    expect(mockedExecFile.mock.calls[0][1]).toEqual([
      "data",
      "get",
      "packager",
      `${stage}-entr-5.8-1`,
      "--json",
    ])
    expect(mockedExecFile.mock.calls[1][1]).toEqual([
      "data",
      "get",
      "packager",
      `${logPrefix}-entr-5.8-1`,
      "--json",
    ])
  })

  it("returns nulls without calling swamp when a versioned stage has no resolved version", async () => {
    const result = await getStageEvidence("entr", "build", null)

    expect(result).toEqual({ stage: "build", evidence: null, log: null })
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it("returns nulls when the evidence and log are both missing (not-found), not an error", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "build-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "buildlog-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const result = await getStageEvidence("entr", "build", "5.8-1")

    expect(result).toEqual({ stage: "build", evidence: null, log: null })
  })
})

describe("getDurableDossier", () => {
  it("returns the dossier-<pkgname>-<version> snapshot's markdown content", async () => {
    mockExecFileOnce(JSON.stringify({ content: "# Package Dossier: entr-5.8-1\n\nFAILED" }))

    const result = await getDurableDossier("entr", "5.8-1")

    expect(result).toBe("# Package Dossier: entr-5.8-1\n\nFAILED")
    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual(["data", "get", "packager", "dossier-entr-5.8-1", "--json"])
  })

  it("returns null when no dossier has been recorded for this version", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "dossier-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    await expect(getDurableDossier("entr", "5.8-1")).resolves.toBeNull()
  })
})

describe("recordRetry argv construction", () => {
  it("passes pkgname, requestedBy, and hint through argv to the record-retry method", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-entr", attributes: { status: "approved" } }],
      })
    )

    await recordRetry("entr", "maintainer1", "remove nodejs/npm from makedepends")

    const [, args] = mockedExecFile.mock.calls[0]
    expect(args).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "record-retry",
      "requests",
      "--input",
      "pkgname=entr",
      "--input",
      "requestedBy=maintainer1",
      "--input",
      "hint=remove nodejs/npm from makedepends",
      "--json",
    ])
  })

  it("rejects with the swamp error when the request isn't 'approved'", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({
        error: "Cannot retry build for 'entr': status is 'unstable', not 'approved'",
        code: "method_execution_failed",
      }),
      new Error("Command failed with exit code 1")
    )

    await expect(recordRetry("entr", "maintainer1", "hint")).rejects.toMatchObject({
      name: "SwampCliError",
      message: "Cannot retry build for 'entr': status is 'unstable', not 'approved'",
    })
  })
})

describe("triggerPackageBuild with hints", () => {
  it("appends a hints --input when hints are provided", () => {
    const request = {
      pkgname: "entr",
      url: "https://example.com/entr.tar.gz",
      description: "A package",
      license: "ISC",
    }

    triggerPackageBuild(request, "remove nodejs/npm from makedepends")

    const [, args] = mockedSpawn.mock.calls[0]
    expect(args).toEqual([
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
      "--input",
      "hints=remove nodejs/npm from makedepends",
      "--json",
    ])
  })

  it("omits the hints --input when hints are absent", () => {
    const request = {
      pkgname: "entr",
      url: "https://example.com/entr.tar.gz",
      description: "A package",
      license: "ISC",
    }

    triggerPackageBuild(request)

    const [, args] = mockedSpawn.mock.calls[0]
    expect((args as string[]).some((a) => a.startsWith("hints="))).toBe(false)
  })
})
