import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import { getRequest, getStageEvidence, isEvidenceStage, resolveEvidenceVersion } from "@/lib/swamp"

/**
 * Per-phase packager evidence for the build-status step checklist and the
 * build report panel: structured evidence + raw log for a single pipeline
 * stage, fetched lazily when a maintainer expands that phase's row.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pkgname: string }> }
) {
  const { pkgname } = await params
  const stage = new URL(request.url).searchParams.get("stage") ?? ""

  if (!isEvidenceStage(stage)) {
    return NextResponse.json(
      { error: `Invalid stage '${stage}': expected analysis, author, checksums, build, lint, or audit` },
      { status: 400 }
    )
  }

  try {
    const record = await getRequest(pkgname)
    const version = await resolveEvidenceVersion(pkgname, record)
    const result = await getStageEvidence(pkgname, stage, version)
    return NextResponse.json(result)
  } catch (error) {
    return swampErrorResponse(error)
  }
}
