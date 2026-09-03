import { NextResponse } from "next/server"

import { SwampCliError } from "@/lib/swamp"

/** Maps a swamp CLI (or unexpected) error to a JSON {error} response. */
export function swampErrorResponse(error: unknown): NextResponse {
  if (error instanceof SwampCliError) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForMessage(error.message) }
    )
  }

  const message = error instanceof Error ? error.message : "Unexpected error"
  return NextResponse.json({ error: message }, { status: 500 })
}

function statusForMessage(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes("already exists")) return 409
  if (lower.includes("no request exists") || lower.includes("not found")) return 404
  if (lower.includes("required") || lower.includes("invalid")) return 400
  return 500
}
