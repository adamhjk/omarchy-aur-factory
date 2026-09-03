"use client"

import { useEffect, useState } from "react"

import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { RequestStatus } from "@/lib/swamp"

interface LifecycleStage {
  key: string
  label: string
}

const STAGES: LifecycleStage[] = [
  { key: "requested", label: "Requested" },
  { key: "approved", label: "Approved" },
  { key: "building", label: "Building" },
  { key: "unstable", label: "Unstable" },
  { key: "stable", label: "Stable" },
]

/**
 * Horizontal requested → approved → building → unstable → stable strip,
 * highlighting the package's current stage. 'building' lights up only while
 * the request is 'approved' and a build run exists (checked once against
 * the build-status API -- the expanded Build panel is what actually polls).
 * 'rejected' renders as its own terminal state instead of the strip.
 */
export function LifecycleStrip({
  pkgname,
  status,
}: {
  pkgname: string
  status: RequestStatus
}) {
  const [fetchedBuilding, setFetchedBuilding] = useState(false)

  useEffect(() => {
    if (status !== "approved") return

    let cancelled = false
    fetch(`/api/requests/${encodeURIComponent(pkgname)}/build-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { building?: boolean } | null) => {
        if (!cancelled) setFetchedBuilding(Boolean(body?.building))
      })
      .catch(() => {
        if (!cancelled) setFetchedBuilding(false)
      })

    return () => {
      cancelled = true
    }
  }, [pkgname, status])

  const building = status === "approved" && fetchedBuilding

  if (status === "rejected") {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
        Rejected
      </div>
    )
  }

  const currentKey = status === "approved" && building ? "building" : status
  const currentIndex = STAGES.findIndex((stage) => stage.key === currentKey)

  return (
    <div
      className="flex flex-wrap items-center gap-y-1"
      aria-label={`Lifecycle stage: ${currentKey}`}
    >
      {STAGES.map((stage, index) => {
        const isCurrent = index === currentIndex
        const isPast = currentIndex >= 0 && index < currentIndex
        return (
          <div key={stage.key} className="flex items-center">
            {index > 0 && (
              <div
                className={cn(
                  "h-px w-2.5 shrink-0 sm:w-4",
                  isPast || isCurrent ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] whitespace-nowrap sm:px-2",
                isCurrent &&
                  "border-primary bg-primary font-medium text-primary-foreground",
                isPast && "border-primary/40 bg-primary/10 text-foreground",
                !isPast && !isCurrent && "border-border text-muted-foreground"
              )}
            >
              {isCurrent && stage.key === "building" && (
                <Loader2Icon className="size-3 animate-spin" />
              )}
              <span className="sr-only sm:not-sr-only">{stage.label}</span>
              <span className="sm:hidden" aria-hidden="true">
                {stage.label.charAt(0)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
