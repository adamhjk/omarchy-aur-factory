import { describe, expect, it } from "vitest"

import { isStaleRun } from "./build-run-freshness"

describe("isStaleRun", () => {
  const retryAt = new Date("2026-01-01T00:10:00.000Z").getTime()

  it("treats a run started well before the retry as stale", () => {
    expect(isStaleRun("2026-01-01T00:00:00.000Z", retryAt)).toBe(true)
  })

  it("treats a run started well after the retry as fresh", () => {
    expect(isStaleRun("2026-01-01T00:10:05.000Z", retryAt)).toBe(false)
  })

  it("treats a run started exactly at the retry time as fresh", () => {
    expect(isStaleRun("2026-01-01T00:10:00.000Z", retryAt)).toBe(false)
  })

  it("tolerates up to ~5s of clock skew before the retry time", () => {
    const justInsideSkew = new Date(retryAt - 4000).toISOString()
    expect(isStaleRun(justInsideSkew, retryAt)).toBe(false)

    const justOutsideSkew = new Date(retryAt - 6000).toISOString()
    expect(isStaleRun(justOutsideSkew, retryAt)).toBe(true)
  })

  it("respects a custom clock-skew tolerance", () => {
    const startedAt = new Date(retryAt - 2000).toISOString()
    expect(isStaleRun(startedAt, retryAt, 1000)).toBe(true)
    expect(isStaleRun(startedAt, retryAt, 3000)).toBe(false)
  })

  it("treats an unparsable timestamp as not stale", () => {
    expect(isStaleRun("not-a-date", retryAt)).toBe(false)
  })
})
