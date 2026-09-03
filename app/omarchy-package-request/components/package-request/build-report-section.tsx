"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/markdown"
import type { BuildReport } from "@/lib/swamp"

import { PhaseEvidenceRow, REPORT_PHASES, STAGE_LABEL } from "./phase-evidence"

/** Client-side cap on the build report fetch, so a stuck request can never leave the section loading forever. */
const FETCH_TIMEOUT_MS = 30_000

function CheckSummaryBadge({
  label,
  summary,
}: {
  label: string
  summary: { passed: boolean; failCount: number; warnCount: number } | null
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {summary ? (
        <Badge variant={summary.passed ? "default" : "destructive"} className="w-fit">
          {summary.passed ? "pass" : "fail"} · {summary.failCount} fail / {summary.warnCount} warn
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">no data</span>
      )}
    </div>
  )
}

/**
 * Build report for a package whose request has already built (status
 * 'unstable' or 'stable'): fetches /api/requests/[pkgname]/report once when
 * mounted. The details panel this lives in doesn't render its children until
 * the row is first expanded, so this fetch is naturally lazy rather than
 * running for every row in the list.
 */
export function BuildReportSection({ pkgname }: { pkgname: string }) {
  const [data, setData] = useState<BuildReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    async function load() {
      try {
        const res = await fetch(`/api/requests/${encodeURIComponent(pkgname)}/report`, {
          signal: controller.signal,
        })
        const body = await res.json().catch(() => null)
        if (cancelled) return

        if (!res.ok) {
          setError(body?.error ?? `Failed to load build report (${res.status})`)
          return
        }

        setData(body as BuildReport)
        setError(null)
      } catch (err) {
        if (cancelled) return
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Timed out loading build report.")
          return
        }
        setError(err instanceof Error ? err.message : "Failed to load build report")
      }
    }

    load()

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [pkgname, attempt])

  const retry = useCallback(() => {
    setError(null)
    setData(null)
    setAttempt((n) => n + 1)
  }, [])

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      {error && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="xs" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {/* Phases have their own per-stage evidence endpoint — render them
          immediately, independent of the report fetch. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Phases
        </span>
        <ol className="flex flex-col gap-1 border-l pl-3">
          {REPORT_PHASES.map((stage) => (
            <li key={stage} className="text-sm">
              <PhaseEvidenceRow
                pkgname={pkgname}
                stage={stage}
                trigger={<span className="font-medium">{STAGE_LABEL[stage]}</span>}
              />
            </li>
          ))}
        </ol>
      </div>

      {!error && !data && (
        <p className="text-sm text-muted-foreground">Loading build report…</p>
      )}

      {!error && data && data.source === null && (
        <p className="text-sm text-muted-foreground">No build report available.</p>
      )}

      {/* The dossier renders directly — always loaded, no disclosure to hunt
          for. The durable-dossier path returns markdown with json: null —
          render whenever markdown exists; badges only need json. */}
      {!error && data?.source === "report" && data.markdown && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Build report
            </span>
            {data.json && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.json.stages).map(([name, stage]) =>
                  stage ? (
                    <Badge key={name} variant={stage.passed ? "default" : "destructive"}>
                      {name}: {stage.passed ? "pass" : "fail"}
                    </Badge>
                  ) : null
                )}
              </div>
            )}
          </div>
          <div className="max-h-96 overflow-auto rounded-md border p-3">
            <Markdown>{data.markdown}</Markdown>
          </div>
        </div>
      )}

      {!error && data?.source === "evidence" && data.evidence && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            The full build report has expired; showing the retained stage evidence instead.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Build
              </span>
              {data.evidence.build ? (
                <>
                  <span className="text-sm">
                    {(data.evidence.build.durationMs / 1000).toFixed(1)}s
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data.evidence.build.artifacts.join(", ") || "no artifacts"}
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">no data</span>
              )}
            </div>
            <CheckSummaryBadge label="Lint" summary={data.evidence.lint} />
            <CheckSummaryBadge label="Audit" summary={data.evidence.audit} />
          </div>
        </div>
      )}
    </div>
  )
}
