"use client"

import { Fragment, useState } from "react"

import { ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
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
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <span className="sr-only">Expand</span>
                  </TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Submitter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  {group.status === "requested" && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => {
                  const isOpen = Boolean(expanded[item.pkgname])
                  const panelId = `request-details-${item.pkgname}`
                  const colSpan = group.status === "requested" ? 8 : 7
                  return (
                    <Fragment key={item.pkgname}>
                      <TableRow>
                        <TableCell>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-label={
                              isOpen
                                ? `Collapse details for ${item.pkgname}`
                                : `Expand details for ${item.pkgname}`
                            }
                            onClick={() => toggleExpanded(item.pkgname)}
                          >
                            <ChevronRightIcon
                              className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                            />
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{item.pkgname}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {item.description}
                        </TableCell>
                        <TableCell>{item.license}</TableCell>
                        <TableCell>{item.submittedBy}</TableCell>
                        <TableCell>
                          <StatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          <LifecycleStrip pkgname={item.pkgname} status={item.status} />
                        </TableCell>
                        {group.status === "requested" && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
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
                          </TableCell>
                        )}
                      </TableRow>
                      <TableRow className="border-b-0 hover:bg-transparent">
                        <TableCell
                          colSpan={colSpan}
                          className="whitespace-normal p-0"
                        >
                          <Collapsible
                            open={isOpen}
                            onOpenChange={(open) =>
                              toggleExpanded(item.pkgname, open)
                            }
                          >
                            <CollapsibleContent id={panelId} className="bg-muted/30">
                              <RequestDetailsPanel request={item} />
                            </CollapsibleContent>
                          </Collapsible>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
