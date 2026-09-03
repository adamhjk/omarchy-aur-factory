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

function getEvidence(pkgname: string, stage: string | null) {
  const url = new URL(`http://localhost/api/requests/${pkgname}/evidence`)
  if (stage !== null) url.searchParams.set("stage", stage)
  const request = new Request(url)
  return GET(request, { params: Promise.resolve({ pkgname }) })
}

beforeEach(() => {
  mockedExecFile.mockReset()
})

describe("GET /api/requests/[pkgname]/evidence", () => {
  it("400s with an {error} body for an invalid stage", async () => {
    const response = await getEvidence("entr", "bogus")
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/invalid stage/i)
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it("400s when the stage query param is missing", async () => {
    const response = await getEvidence("entr", null)

    expect(response.status).toBe(400)
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it("resolves the version from request.version, then fetches the stage evidence and log", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "entr", version: "5.8-1" } }] })
    ) // getRequest
    mockExecFileOnce(JSON.stringify({ content: { name: "entr-5.8-1", passed: false, exitCode: 1 } })) // build-entr-5.8-1
    mockExecFileOnce(
      JSON.stringify({ content: "makepkg: error: Missing dependencies: nodejs npm" })
    ) // buildlog-entr-5.8-1

    const response = await getEvidence("entr", "build")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      stage: "build",
      evidence: { name: "entr-5.8-1", passed: false, exitCode: 1 },
      log: "makepkg: error: Missing dependencies: nodejs npm",
    })
    expect(mockedExecFile).toHaveBeenCalledTimes(3)
    expect(mockedExecFile.mock.calls[1][1]).toEqual([
      "data",
      "get",
      "packager",
      "build-entr-5.8-1",
      "--json",
    ])
    expect(mockedExecFile.mock.calls[2][1]).toEqual([
      "data",
      "get",
      "packager",
      "buildlog-entr-5.8-1",
      "--json",
    ])
  })

  it("falls back to the author stage's version when request.version is unset", async () => {
    mockExecFileOnce(
      JSON.stringify({ results: [{ content: { pkgname: "entr", version: "" } }] })
    ) // getRequest
    mockExecFileOnce(JSON.stringify({ content: { version: "5.8-1" } })) // author-entr
    mockExecFileOnce(JSON.stringify({ content: { name: "entr-5.8-1", passed: true } })) // lint-entr-5.8-1
    mockExecFileOnce(JSON.stringify({ content: "no lint issues" })) // lintlog-entr-5.8-1

    const response = await getEvidence("entr", "lint")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.evidence).toEqual({ name: "entr-5.8-1", passed: true })
    expect(mockedExecFile.mock.calls[2][1]).toEqual([
      "data",
      "get",
      "packager",
      "lint-entr-5.8-1",
      "--json",
    ])
  })

  it("returns nulls (not an error) when no data has been recorded yet for the stage", async () => {
    mockExecFileOnce(JSON.stringify({ results: [{ content: { pkgname: "entr", version: "" } }] }))
    mockExecFileOnce(
      "",
      JSON.stringify({ error: 'Data not found: "author-entr" for model "packager"' }),
      new Error("Command failed with exit code 1")
    )

    const response = await getEvidence("entr", "build")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ stage: "build", evidence: null, log: null })
  })
})
