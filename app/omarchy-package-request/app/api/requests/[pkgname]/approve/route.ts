import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import { ruleOnRequest, triggerPackageBuild, type RulingAction } from "@/lib/swamp"

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
  const { approver, action, reason } = record

  if (typeof approver !== "string" || !approver) {
    return NextResponse.json({ error: "approver is required" }, { status: 400 })
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 }
    )
  }
  if (action === "reject" && (typeof reason !== "string" || !reason.trim())) {
    return NextResponse.json(
      { error: "reason is required to reject a request" },
      { status: 400 }
    )
  }

  try {
    const updated = await ruleOnRequest(
      pkgname,
      approver,
      action as RulingAction,
      typeof reason === "string" ? reason : undefined
    )

    if (action === "approve") {
      let triggered = false
      try {
        triggerPackageBuild(updated)
        triggered = true
      } catch (err) {
        // The approval itself already succeeded; a failure kicking off the
        // build (e.g. scratch dir not writable) shouldn't fail the request.
        console.error(`Failed to trigger package build for '${pkgname}':`, err)
      }
      return NextResponse.json({ ...updated, triggered })
    }

    return NextResponse.json(updated)
  } catch (error) {
    return swampErrorResponse(error)
  }
}
