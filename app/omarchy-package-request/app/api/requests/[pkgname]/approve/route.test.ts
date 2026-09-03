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

function postApprove(pkgname: string, body: unknown) {
  const request = new Request(`http://localhost/api/requests/${pkgname}/approve`, {
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
  history: [],
  updatedAt: "2026-09-03T00:00:00.000Z",
}

const rejectedAttributes = {
  ...approvedAttributes,
  status: "rejected",
  maintainerApproval: null,
  rejectionReason: "not maintained upstream",
}

beforeEach(() => {
  mockedExecFile.mockReset()
  mockedSpawn.mockReset()
  mockedSpawn.mockReturnValue({
    on: vi.fn(),
    unref: vi.fn(),
  } as unknown as ReturnType<typeof spawn>)
})

describe("POST /api/requests/[pkgname]/approve", () => {
  it("on approve: spawns the create-package workflow detached, with url/license through argv, and returns triggered:true", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-entr", attributes: approvedAttributes }],
      })
    )

    const response = await postApprove("entr", {
      approver: "maintainer1",
      action: "approve",
    })
    const responseBody = await response.json()

    expect(response.status).toBe(200)
    expect(responseBody).toMatchObject({ ...approvedAttributes, triggered: true })

    // The 'approve' method call itself, via execFile (argv, no shell).
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    const [execBin, execArgs, execOptions] = mockedExecFile.mock.calls[0]
    expect(execBin).toBe("swamp")
    expect(execArgs).toEqual([
      "model",
      "method",
      "run",
      "@omarchy/package-request",
      "approve",
      "requests",
      "--input",
      "pkgname=entr",
      "--input",
      "approver=maintainer1",
      "--json",
    ])
    expect(execOptions).not.toHaveProperty("shell")

    // The detached, fire-and-forget create-package spawn.
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

  it("on reject: does NOT spawn the build, and the response has no triggered flag", async () => {
    mockExecFileOnce(
      JSON.stringify({
        dataArtifacts: [{ name: "request-entr", attributes: rejectedAttributes }],
      })
    )

    const response = await postApprove("entr", {
      approver: "maintainer1",
      action: "reject",
      reason: "not maintained upstream",
    })
    const responseBody = await response.json()

    expect(response.status).toBe(200)
    expect(responseBody).toEqual(rejectedAttributes)
    expect(responseBody.triggered).toBeUndefined()
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it("does not spawn when the swamp approve call itself fails", async () => {
    mockExecFileOnce(
      "",
      JSON.stringify({ error: "No request exists for 'entr'", code: "not_found" }),
      new Error("Command failed with exit code 1")
    )

    const response = await postApprove("entr", {
      approver: "maintainer1",
      action: "approve",
    })

    expect(response.status).toBe(404)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })
})
