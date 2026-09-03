import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import {
  getBuildReport,
  getDurableDossier,
  getRequest,
  resolveEvidenceVersion,
  type BuildReport,
} from "@/lib/swamp"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pkgname: string }> }
) {
  const { pkgname } = await params

  try {
    const record = await getRequest(pkgname)
    const version = await resolveEvidenceVersion(pkgname, record)

    // The durable per-package dossier the pipeline writes on every run
    // (success or failure) never ages out, so it's checked before the
    // @omarchy/package-dossier report / version-walk / evidence chain below
    // -- that's what makes failure dossiers reliably visible.
    if (version) {
      const durable = await getDurableDossier(pkgname, version)
      if (durable !== null) {
        const report: BuildReport = { source: "report", markdown: durable, json: null, evidence: null }
        return NextResponse.json(report)
      }
    }

    const report = await getBuildReport(pkgname, version ?? "")
    return NextResponse.json(report)
  } catch (error) {
    return swampErrorResponse(error)
  }
}
