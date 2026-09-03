"use client"

import * as React from "react"
import { useState } from "react"

import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { EvidenceStage, StageEvidence } from "@/lib/swamp"

export const STAGE_LABEL: Record<EvidenceStage, string> = {
  analysis: "Analysis",
  author: "Author",
  checksums: "Checksums",
  build: "Build",
  lint: "Lint",
  audit: "Audit",
}

function LevelBadge({ level }: { level: string }) {
  const variant = level === "pass" ? "default" : level === "warn" ? "secondary" : "destructive"
  return <Badge variant={variant}>{level}</Badge>
}

function EvidenceField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm break-words">{children}</span>
    </div>
  )
}

/** Renders one stage's structured evidence: passed badge, stage-specific fields, and a checks table. */
function EvidenceBody({
  stage,
  evidence,
}: {
  stage: EvidenceStage
  evidence: Record<string, unknown>
}) {
  const passed = Boolean(evidence.passed)
  const checks = Array.isArray(evidence.checks)
    ? (evidence.checks as Array<{ name: string; level: string; detail: string }>)
    : null

  return (
    <div className="flex flex-col gap-3">
      <Badge variant={passed ? "default" : "destructive"} className="w-fit">
        {passed ? "passed" : "failed"}
      </Badge>

      {stage === "author" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {typeof evidence.version === "string" && evidence.version && (
            <EvidenceField label="Version">{evidence.version}</EvidenceField>
          )}
          {Array.isArray(evidence.license) && (
            <EvidenceField label="License">
              {(evidence.license as string[]).join(", ") || "unknown"}
            </EvidenceField>
          )}
          {Array.isArray(evidence.depends) && (
            <EvidenceField label="Depends">
              {(evidence.depends as string[]).join(", ") || "none"}
            </EvidenceField>
          )}
          {Array.isArray(evidence.makedepends) && (
            <EvidenceField label="Makedepends">
              {(evidence.makedepends as string[]).join(", ") || "none"}
            </EvidenceField>
          )}
        </div>
      )}

      {typeof evidence.rationale === "string" && evidence.rationale && (
        <EvidenceField label="Rationale">
          <p className="whitespace-pre-wrap">{evidence.rationale}</p>
        </EvidenceField>
      )}

      {stage === "build" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {typeof evidence.durationMs === "number" && (
            <EvidenceField label="Duration">
              {(evidence.durationMs / 1000).toFixed(1)}s
            </EvidenceField>
          )}
          {Array.isArray(evidence.artifacts) && (
            <EvidenceField label="Artifacts">
              {(evidence.artifacts as string[]).join(", ") || "none"}
            </EvidenceField>
          )}
        </div>
      )}

      {checks && checks.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Level</TableHead>
              <TableHead>Check</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((check, index) => (
              <TableRow key={`${check.name}-${index}`}>
                <TableCell>
                  <LevelBadge level={check.level} />
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {check.name}
                </TableCell>
                <TableCell className="max-w-md whitespace-pre-wrap text-xs">
                  {check.detail}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/**
 * One expandable packager pipeline phase: lazily fetches
 * /api/requests/[pkgname]/evidence?stage=<stage> the first time it's
 * expanded, then renders the structured evidence (passed badge, stage-
 * specific fields, checks table) plus a collapsed raw-log section. This is
 * how a maintainer sees *why* a phase failed (e.g. the build log's "Missing
 * dependencies: nodejs npm").
 */
export function PhaseEvidenceRow({
  pkgname,
  stage,
  trigger,
}: {
  pkgname: string
  stage: EvidenceStage
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState<StageEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next || loaded) return

    setLoaded(true)
    fetch(`/api/requests/${encodeURIComponent(pkgname)}/evidence?stage=${stage}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          setError(body?.error ?? `Failed to load ${stage} evidence (${res.status})`)
          return
        }
        setData(body as StageEvidence)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : `Failed to load ${stage} evidence`)
      })
  }

  const label = STAGE_LABEL[stage].toLowerCase()

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:bg-muted/50"
        aria-label={`${open ? "Collapse" : "Expand"} ${STAGE_LABEL[stage]} evidence`}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        {trigger}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 py-2 pl-5">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && !data && (
            <p className="text-sm text-muted-foreground">Loading {label} evidence…</p>
          )}
          {!error && data && !data.evidence && (
            <p className="text-sm text-muted-foreground">
              No {label} evidence recorded yet.
            </p>
          )}
          {!error && data?.evidence && <EvidenceBody stage={stage} evidence={data.evidence} />}
          {!error && data?.log && (
            <Collapsible>
              <CollapsibleTrigger
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
              >
                Raw log
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                  {data.log}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Step name -> evidence stage, for the subset of build-status steps that are packager pipeline phases. */
export const STEP_TO_STAGE: Record<string, EvidenceStage> = {
  analyze: "analysis",
  author: "author",
  checksums: "checksums",
  build: "build",
  lint: "lint",
  audit: "audit",
}

/** Fixed phase order shown in the build report panel, regardless of which steps a workflow run happened to expose. */
export const REPORT_PHASES: EvidenceStage[] = [
  "analysis",
  "author",
  "checksums",
  "build",
  "lint",
  "audit",
]
