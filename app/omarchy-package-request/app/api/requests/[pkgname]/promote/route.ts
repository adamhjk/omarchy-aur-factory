import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import { approvePromotion, type PromotionRole } from "@/lib/swamp"

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
  const { approver, role } = record

  if (typeof approver !== "string" || !approver) {
    return NextResponse.json({ error: "approver is required" }, { status: 400 })
  }
  if (role !== "maintainer" && role !== "user") {
    return NextResponse.json(
      { error: "role must be 'maintainer' or 'user'" },
      { status: 400 }
    )
  }

  try {
    const updated = await approvePromotion(pkgname, approver, role as PromotionRole)
    return NextResponse.json(updated)
  } catch (error) {
    return swampErrorResponse(error)
  }
}
