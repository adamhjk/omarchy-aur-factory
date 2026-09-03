import { NextResponse } from "next/server"

import { swampErrorResponse } from "@/lib/api-error"
import { queryRequests, submitRequest, type SubmitInput } from "@/lib/swamp"

const REQUIRED_FIELDS: Array<keyof SubmitInput> = [
  "pkgname",
  "url",
  "description",
  "license",
  "submitter",
]

export async function GET() {
  try {
    const requests = await queryRequests()
    return NextResponse.json(requests)
  } catch (error) {
    return swampErrorResponse(error)
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const record = (body ?? {}) as Record<string, unknown>
  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof record[field] !== "string" || !record[field]
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(", ")}` },
      { status: 400 }
    )
  }

  const input: SubmitInput = {
    pkgname: record.pkgname as string,
    url: record.url as string,
    description: record.description as string,
    license: record.license as string,
    submitter: record.submitter as string,
  }

  try {
    const created = await submitRequest(input)
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return swampErrorResponse(error)
  }
}
