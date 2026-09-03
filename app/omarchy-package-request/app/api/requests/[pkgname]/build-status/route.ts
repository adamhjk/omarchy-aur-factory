import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import { getBuildStatus } from "@/lib/swamp"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pkgname: string }> }
) {
  const { pkgname } = await params

  try {
    const status = await getBuildStatus(pkgname)
    return NextResponse.json(status)
  } catch (error) {
    return swampErrorResponse(error)
  }
}
