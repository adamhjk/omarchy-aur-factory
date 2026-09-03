import { NextResponse } from "next/server"

import { SwampCliError, recordRetry, triggerPackageBuild } from "@/lib/swamp"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pkgname: string }> }
) {
  const { pkgname } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const record = (body ?? {}) as Record<string, unknown>
  const { approver, hints } = record

  if (typeof approver !== "string" || !approver) {
    return NextResponse.json({ error: "approver is required" }, { status: 400 })
  }
  if (typeof hints !== "string" || !hints.trim()) {
    return NextResponse.json({ error: "hints are required to retry a build" }, { status: 400 })
  }

  let updated
  try {
    updated = await recordRetry(pkgname, approver, hints)
  } catch (error) {
    // record-retry only fails when no request exists or it isn't currently
    // 'approved' -- both are conflicts with retrying a build, not server
    // errors, so surface them as 409 rather than the generic 500.
    const message =
      error instanceof SwampCliError || error instanceof Error
        ? error.message
        : "Failed to record retry"
    return NextResponse.json({ error: message }, { status: 409 })
  }

  try {
    triggerPackageBuild(updated, hints)
  } catch (err) {
    // The retry itself was already recorded; a failure kicking off the
    // rebuild (e.g. scratch dir not writable) shouldn't fail the request.
    console.error(`Failed to trigger retry build for '${pkgname}':`, err)
  }

  return NextResponse.json({ triggered: true })
}
