"use client"

import { useEffect, useState } from "react"

import { CheckIcon, CircleIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Markdown } from "@/components/markdown"
import { isStaleRun } from "@/lib/build-run-freshness"
import { cn } from "@/lib/utils"
import type { BuildStatus } from "@/lib/swamp"

import { BuildReportSection } from "./build-report-section"
import { PhaseEvidenceRow, STEP_TO_STAGE } from "./phase-evidence"

const ACTIVE_RUN_STATUSES = new Set(["running", "pending"])

const POLL_INTERVAL_MS = 5000

function StepStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") {
    return <CheckIcon className="size-3.5 shrink-0 text-primary" aria-label="succeeded" />
  }
  if (status === "failed") {
    return <XIcon className="size-3.5 shrink-0 text-destructive" aria-label="failed" />
  }
  if (status === "running") {
    return (
      <Loader2Icon
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
        aria-label="running"
      />
    )
  }
  return (
    <CircleIcon
      className="size-3.5 shrink-0 text-muted-foreground/40"
      aria-label={status || "pending"}
    />
  )
}

/**
 * Live build status for a package whose request is 'approved': polls
 * /api/requests/[pkgname]/build-status every 5s while the newest
 * create-package run is running/pending, and renders the final dossier once
 * the build succeeds and one is available.
 */
export function BuildSection({ pkgname }: { pkgname: string }) {
  const [data, setData] = useState<BuildStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped after a successful retry to restart the poll loop below (a fresh
  // build run needs fresh polling even though `pkgname` hasn't changed).
  const [retryTick, setRetryTick] = useState(0)
  // Client-clock timestamp of the most recent retry. While set, any run
  // returned by build-status whose startedAt predates it (see isStaleRun)
  // is treated as belonging to the previous attempt and not rendered --
  // otherwise the checklist flashes the old attempt's step statuses until
  // the new run overtakes it in the history search.
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const [hints, setHints] = useState("")
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      try {
        const res = await fetch(`/api/requests/${encodeURIComponent(pkgname)}/build-status`)
        const body = await res.json().catch(() => null)
        if (cancelled) return

        if (!res.ok) {
          setError(body?.error ?? `Failed to load build status (${res.status})`)
          return
        }

        const status = body as BuildStatus
        setError(null)
        setData(status)

        // Right after a retry, the previous attempt's (possibly terminal)
        // run may still be what build-status returns until the new
        // create-package run shows up in history search -- keep polling
        // through that window instead of stopping on the stale run's
        // terminal status.
        const awaitingFreshRun =
          retryAt !== null && (!status.run || isStaleRun(status.run.startedAt, retryAt))
        const shouldContinue =
          awaitingFreshRun ||
          (status.building &&
            !status.dossier &&
            ACTIVE_RUN_STATUSES.has(status.run?.status ?? ""))
        if (shouldContinue) {
          timer = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load build status")
        }
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pkgname, retryTick, retryAt])

  async function retryWithHints() {
    if (!hints.trim()) return
    const approver = window.prompt(`Retry the build for '${pkgname}' as:`)
    if (!approver) return

    setRetrying(true)
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(pkgname)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approver, hints }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.add({
          title: "Failed to retry build",
          description: body?.error ?? `Request failed (${res.status})`,
          type: "error",
        })
        return
      }
      toast.add({
        title: "Retry triggered",
        description: `Rebuilding '${pkgname}' with maintainer hints.`,
        type: "success",
      })
      setHints("")
      // Restart polling: a fresh create-package run has just been spawned.
      // Wipe the displayed run immediately and record when this retry fired
      // so stale (previous-attempt) statuses aren't shown in the meantime.
      setData(null)
      setError(null)
      setRetryAt(Date.now())
      setRetryTick((tick) => tick + 1)
    } catch (err) {
      toast.add({
        title: "Failed to retry build",
        description: err instanceof Error ? err.message : "Request failed",
        type: "error",
      })
    } finally {
      setRetrying(false)
    }
  }

  // While a retry is in flight, build-status may still report the previous
  // attempt's (possibly terminal) run until the new create-package run
  // shows up in history search. Keep showing "Starting new build…" instead
  // of that stale run's steps until one that actually started at/after the
  // retry appears.
  const awaitingFreshRun =
    retryAt !== null && (!data?.run || isStaleRun(data.run.startedAt, retryAt))

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Build
      </span>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!error && awaitingFreshRun && (
        <p className="text-sm text-muted-foreground">Starting new build…</p>
      )}

      {!error && !awaitingFreshRun && !data && (
        <p className="text-sm text-muted-foreground">Loading build status…</p>
      )}

      {!error && !awaitingFreshRun && data && !data.run && (
        <p className="text-sm text-muted-foreground">
          No build run found yet for this package.
        </p>
      )}

      {!error && !awaitingFreshRun && data?.run && (
        <div key={data.run.runId} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{data.run.status}</span>
            <span className="text-xs text-muted-foreground">
              {data.run.stepProgress.completed} of {data.run.stepProgress.total} steps
            </span>
          </div>
          <Progress
            value={
              data.run.stepProgress.total > 0
                ? (data.run.stepProgress.completed / data.run.stepProgress.total) * 100
                : 0
            }
          >
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>

          {data.steps && data.steps.length > 0 && (
            <ol className="flex flex-col gap-1.5 border-l pl-3">
              {data.steps.map((step, index) => {
                const rowContent = (
                  <span className="flex flex-wrap items-center gap-2">
                    <StepStatusIcon status={step.status} />
                    <span className="font-medium">
                      {step.job}/{step.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{step.status}</span>
                    {typeof step.duration === "number" && (
                      <span className="text-xs text-muted-foreground">
                        {(step.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </span>
                )
                const stage = STEP_TO_STAGE[step.name]
                return (
                  <li key={`${step.job}-${step.name}-${index}`} className="text-sm">
                    {stage ? (
                      <PhaseEvidenceRow pkgname={pkgname} stage={stage} trigger={rowContent} />
                    ) : (
                      rowContent
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {data.dossier && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Dossier stages
              </span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.dossier.json.stages).map(([name, stage]) =>
                  stage ? (
                    <Badge key={name} variant={stage.passed ? "default" : "destructive"}>
                      {name}: {stage.passed ? "pass" : "fail"}
                    </Badge>
                  ) : null
                )}
              </div>
              <Collapsible>
                <CollapsibleTrigger
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
                >
                  Full dossier
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 max-h-96 overflow-auto rounded-md border p-3">
                    <Markdown>{data.dossier.markdown}</Markdown>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {data.run.status === "failed" && (
            <>
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Build failed</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-2 pt-1">
                    <p>
                      Inspect the failing phase above (or the build report below) for why,
                      then describe what to change for the next attempt.
                    </p>
                    <Textarea
                      value={hints}
                      onChange={(event) => setHints(event.target.value)}
                      placeholder="e.g. remove nodejs/npm from makedepends; the compile script only needs deno"
                      rows={3}
                      disabled={retrying}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      disabled={retrying || !hints.trim()}
                      onClick={retryWithHints}
                    >
                      {retrying ? "Retrying…" : "Retry with hints"}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              <BuildReportSection pkgname={pkgname} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
