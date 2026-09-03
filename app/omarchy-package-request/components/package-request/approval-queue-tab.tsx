"use client"

import { useState } from "react"

import { ChevronRightIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { PackageRequest, RequestStatus } from "@/lib/swamp"

import { LifecycleStrip } from "./lifecycle-strip"
import { RequestDetailsPanel } from "./request-details-panel"
import { StatusBadge } from "./status-badge"

const CATEGORY_ORDER: RequestStatus[] = [
  "requested",
  "approved",
  "unstable",
  "stable",
  "rejected",
]

const CATEGORY_TITLE: Record<RequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  unstable: "Unstable",
  stable: "Stable",
  rejected: "Rejected",
}

interface ApprovalQueueTabProps {
  requests: PackageRequest[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

export function ApprovalQueueTab({
  requests,
  loading,
  error,
  onChanged,
}: ApprovalQueueTabProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function toggleExpanded(pkgname: string, open?: boolean) {
    setExpanded((prev) => ({
      ...prev,
      [pkgname]: open ?? !prev[pkgname],
    }))
  }

  async function rule(pkgname: string, action: "approve" | "reject") {
    const approver = window.prompt(
      `${action === "approve" ? "Approve" : "Reject"} '${pkgname}' as:`
    )
    if (!approver) return

    let reason: string | undefined
    if (action === "reject") {
      const reasonInput = window.prompt(`Reason for rejecting '${pkgname}':`)
      if (!reasonInput) {
        toast.add({
          title: "Rejection cancelled",
          description: "A reason is required to reject a request.",
          type: "warning",
        })
        return
      }
      reason = reasonInput
    }

    setPending(pkgname)
    try {
      const res = await fetch(
        `/api/requests/${encodeURIComponent(pkgname)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approver, action, reason }),
        }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.add({
          title: `Failed to ${action}`,
          description: body?.error ?? `Request failed (${res.status})`,
          type: "error",
        })
        return
      }
      toast.add({
        title: action === "approve" ? "Request approved" : "Request rejected",
        description: `'${pkgname}'`,
        type: "success",
      })
      // Expand the row immediately when the build was triggered, so the
      // Build section mounts and starts polling without waiting on a manual
      // expand -- the refreshed list (via onChanged) is what actually flips
      // the row's status to 'approved'.
      if (action === "approve" && body?.triggered) {
        toggleExpanded(pkgname, true)
      }
      onChanged()
    } catch (err) {
      toast.add({
        title: `Failed to ${action}`,
        description: err instanceof Error ? err.message : "Request failed",
        type: "error",
      })
    } finally {
      setPending(null)
    }
  }

  if (loading && requests.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading requests…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No package requests yet.</p>
    )
  }

  const grouped = CATEGORY_ORDER.map((status) => ({
    status,
    items: requests.filter((item) => item.status === status),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex flex-col gap-6">
      {grouped.map((group) => (
        <Card key={group.status}>
          <CardHeader>
            <CardTitle>{CATEGORY_TITLE[group.status]}</CardTitle>
            <CardDescription>
              {group.items.length} package{group.items.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {group.items.map((item) => {
              const isOpen = Boolean(expanded[item.pkgname])
              return (
                <Collapsible
                  key={item.pkgname}
                  open={isOpen}
                  onOpenChange={(open) => toggleExpanded(item.pkgname, open)}
                  className="rounded-lg border"
                >
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <CollapsibleTrigger
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon" }),
                          "size-7 shrink-0 transition-transform data-[panel-open]:rotate-90"
                        )}
                        aria-label={
                          isOpen
                            ? `Collapse details for ${item.pkgname}`
                            : `Expand details for ${item.pkgname}`
                        }
                      >
                        <ChevronRightIcon className="size-4 shrink-0" />
                      </CollapsibleTrigger>
                      <span className="min-w-0 truncate font-medium">
                        {item.pkgname}
                      </span>
                      <StatusBadge status={item.status} />
                      {group.status === "requested" && (
                        <div className="flex gap-2 sm:ml-auto">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending === item.pkgname}
                            onClick={() => rule(item.pkgname, "approve")}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending === item.pkgname}
                            onClick={() => rule(item.pkgname, "reject")}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-1 pl-9 text-sm text-muted-foreground md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <span className="truncate" title={item.description}>
                        {item.description}
                      </span>
                      <span className="truncate">{item.license}</span>
                      <span className="truncate">{item.submittedBy}</span>
                    </div>
                    <div className="pl-9">
                      <LifecycleStrip
                        pkgname={item.pkgname}
                        status={item.status}
                      />
                    </div>
                  </div>
                  <CollapsibleContent className="border-t bg-muted/30">
                    <RequestDetailsPanel request={item} />
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
