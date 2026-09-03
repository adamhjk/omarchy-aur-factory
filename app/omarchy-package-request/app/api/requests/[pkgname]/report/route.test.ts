import { execFile } from "node:child_process"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}))

import { GET } from "./route"

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void

const mockedExecFile = vi.mocked(execFile)

/** Configures the next execFile call to invoke its callback with the given result. */
function mockExecFileOnce(stdout: string, stderr = "", error: Error | null = null) {
  mockedExecFile.mockImplementationOnce((..._args: unknown[]) => {
    const callback = _args[_args.length - 1] as ExecFileCallback
    callback(error, stdout, stderr)
    return {} as ReturnType<typeof execFile>
  })
}

function getReport(pkgname: string) {
  const request = new Request(`http://localhost/api/requests/${pkgname}/report`)
  return GET(request, { params: Promise.resolve({ pkgname }) })
}

beforeEach(() => {
  mockedExecFile.mockReset()
})

describe("GET /api/requests/[pkgname]/report", () => {
  it("returns the durable dossier before consulting the @omarchy/package-dossier report chain", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "entr", version: "5.8-1" } }] })
    ) // getRequest
    mockExecFileOnce(
      JSON.stringify({ content: "# Package Dossier: entr-5.8-1\n\n## Build — FAILED\n" })
    ) // dossier-entr-5.8-1

    const response = await getReport("entr")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      source: "report",
      markdown: "# Package Dossier: entr-5.8-1\n\n## Build — FAILED\n",
      json: null,
      evidence: null,
    })
    // Only the request lookup and the durable dossier fetch -- the report-get
    // / version-walk / evidence chain must not run once the durable dossier
    // is found.
    expect(mockedExecFile).toHaveBeenCalledTimes(2)
    expect(mockedExecFile.mock.calls[1][1]).toEqual([
      "data",
      "get",
      "packager",
      "dossier-entr-5.8-1",
      "--json",
    ])
  })

  it("falls back to the current-report-get / evidence chain when no durable dossier is recorded", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "entr", version: "5.8-1" } }] })
    ) // getRequest
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "dossier-entr-5.8-1" for model "packager"' }),
      new Error("Command failed with exit code 1")
    ) // durable dossier miss
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other", workflowRunId: "run-x", stages: {}, notes: [] } })
    ) // @omarchy/package-dossier report get (mismatched pkgname -- another package built more recently)
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

    const response = await getReport("entr")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ source: null, markdown: null, json: null, evidence: null })
    // getRequest + durable miss + report get + lint/audit/build -- 6 calls,
    // no version-walk in between.
    expect(mockedExecFile).toHaveBeenCalledTimes(6)
  })

  it("skips the durable-dossier lookup entirely when no version can be resolved", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "entr", version: "" } }] })
    ) // getRequest
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "author-entr" for model "packager"' }),
      new Error("Command failed with exit code 1")
    ) // author fallback miss -> version stays null
    mockExecFileOnce(
      JSON.stringify({ json: { pkgname: "other", workflowRunId: "run-x", stages: {}, notes: [] } })
    ) // report get (mismatch, version "")
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "lint-entr-" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "audit-entr-" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "build-entr-" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const response = await getReport("entr")
    const body = await response.json()

    expect(body.source).toBeNull()
    // getRequest + author fallback + report get + lint/audit/build --
    // no dossier-entr-<version> lookup happens when no version resolves.
    expect(mockedExecFile).toHaveBeenCalledTimes(6)
  })

  it("propagates a timed-out swamp CLI call as a 502 with a clear message", async () => {
    mockedExecFile.mockImplementationOnce((..._args: unknown[]) => {
      const callback = _args[_args.length - 1] as ExecFileCallback
      const error = Object.assign(new Error("Command failed"), {
        killed: true,
        signal: "SIGKILL",
      })
      callback(error, "", "")
      return {} as ReturnType<typeof execFile>
    })

    const response = await getReport("entr")
    const body = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(body.error).toBe("swamp CLI call timed out")
  })
})
