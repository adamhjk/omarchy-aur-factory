import { execFile, spawn } from "node:child_process"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}))

import { BUILD_SCRATCH_DIR, PACKAGES_DIR, SWAMP_DIR } from "@/lib/swamp"

import { POST } from "./route"

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void

const mockedExecFile = vi.mocked(execFile)
const mockedSpawn = vi.mocked(spawn)

/** Configures the next execFile call to invoke its callback with the given result. */
function mockExecFileOnce(stdout: string, stderr = "", error: Error | null = null) {
  mockedExecFile.mockImplementationOnce((..._args: unknown[]) => {
    const callback = _args[_args.length - 1] as ExecFileCallback
    callback(error, stdout, stderr)
    return {} as ReturnType<typeof execFile>
  })
}

function postRetry(pkgname: string, body: unknown) {
  const request = new Request(`http://localhost/api/requests/${pkgname}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ pkgname }) })
}

const approvedAttributes = {
  pkgname: "entr",
  url: "https://github.com/eradman/entr/archive/5.6.tar.gz",
  description: "Run arbitrary commands when files change",
  license: "ISC",
  status: "approved",
  submittedBy: "adam",
  version: "",
  maintainerApproval: { by: "maintainer1", at: "2026-09-03T00:00:00.000Z" },
  promotionMaintainer: null,
  promotionUser: null,
  rejectionReason: "",
  history: [{ at: "2026-09-03T00:00:00.000Z", event: "retry-requested", by: "maintainer1", detail: "hint" }],
  updatedAt: "2026-09-03T00:00:00.000Z",
}

beforeEach(() => {
  mockedExecFile.mockReset()
  mockedSpawn.mockReset()
  mockedSpawn.mockReturnValue({
    on: vi.fn(),
    unref: vi.fn(),
  } as unknown as ReturnType<typeof spawn>)
})

describe("POST /api/requests/[pkgname]/retry", () => {
  it("400s when approver is missing", async () => {
    const response = await postRetry("entr", { hints: "remove nodejs" })
    expect(response.status).toBe(400)
    expect(mockedExecFile).not.toHaveBeenCalled()
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it("400s when hints are missing or blank", async () => {
    const response = await postRetry("entr", { approver: "maintainer1", hints: "   " })
    expect(response.status).toBe(400)
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it("records the retry then spawns create-package detached with hints in argv, and returns {triggered:true}", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-entr", attributes: approvedAttributes }],
      })
    )

    const response = await postRetry("entr", {
      approver: "maintainer1",
      hints: "remove nodejs/npm from makedepends; the compile script only needs deno",
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ triggered: true })

    // record-retry, via execFile (argv, no shell).
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    const [execBin, execArgs, execOptions] = mockedExecFile.mock.calls[0]
    expect(execBin).toBe("swamp")
    expect(execArgs).toEqual([
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
      "hint=remove nodejs/npm from makedepends; the compile script only needs deno",
      "--json",
    ])
    expect(execOptions).not.toHaveProperty("shell")

    // The detached, fire-and-forget create-package spawn, with hints appended.
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    const [spawnBin, spawnArgs, spawnOptions] = mockedSpawn.mock.calls[0]
    expect(spawnBin).toBe("swamp")
    expect(spawnArgs).toEqual([
      "workflow",
      "run",
      "create-package",
      "--input",
      `pkgname=${approvedAttributes.pkgname}`,
      "--input",
      `url=${approvedAttributes.url}`,
      "--input",
      `description=${approvedAttributes.description}`,
      "--input",
      `license=${approvedAttributes.license}`,
      "--input",
      `dir=${PACKAGES_DIR}/${approvedAttributes.pkgname}`,
      "--input",
      `workdir=${BUILD_SCRATCH_DIR}/${approvedAttributes.pkgname}`,
      "--input",
      "hints=remove nodejs/npm from makedepends; the compile script only needs deno",
      "--json",
    ])
    expect(spawnOptions).toMatchObject({
      cwd: SWAMP_DIR,
      detached: true,
      stdio: "ignore",
    })
    expect(spawnOptions).not.toHaveProperty("shell")

    const spawnedChild = mockedSpawn.mock.results[0].value as { unref: ReturnType<typeof vi.fn> }
    expect(spawnedChild.unref).toHaveBeenCalledTimes(1)
  })

  it("409s and does not spawn when record-retry errors (e.g. status isn't 'approved')", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({
        error: "Cannot retry build for 'entr': status is 'unstable', not 'approved'",
        code: "method_execution_failed",
      }),
      new Error("Command failed with exit code 1")
    )

    const response = await postRetry("entr", {
      approver: "maintainer1",
      hints: "remove nodejs/npm from makedepends",
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe("Cannot retry build for 'entr': status is 'unstable', not 'approved'")
    expect(mockedSpawn).not.toHaveBeenCalled()
  })
})
