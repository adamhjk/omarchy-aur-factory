"use client"

import { useState } from "react"

import { ChevronRightIcon, SparklesIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
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
import type { PackageRequest, PromotionRole } from "@/lib/swamp"

import { LifecycleStrip } from "./lifecycle-strip"
import { PromotionSlots } from "./promotion-slots"
import { RequestDetailsPanel } from "./request-details-panel"

interface PromotionTabProps {
  requests: PackageRequest[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

export function PromotionTab({
  requests,
  loading,
  error,
  onChanged,
}: PromotionTabProps) {
  const [pending, setPending] = useState<string | null>(null)

  const unstable = requests.filter((item) => item.status === "unstable")
  const stable = requests.filter((item) => item.status === "stable")

  async function approve(pkgname: string, role: PromotionRole) {
    const approver = window.prompt(
      `${role === "maintainer" ? "Maintainer" : "User"} approving '${pkgname}' as:`
    )
    if (!approver) return

    const key = `${pkgname}:${role}`
    setPending(key)
    try {
      const res = await fetch(
        `/api/requests/${encodeURIComponent(pkgname)}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approver, role }),
        }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.add({
          title: "Promotion approval failed",
          description: body?.error ?? `Request failed (${res.status})`,
          type: "error",
        })
        return
      }
      if ((body as PackageRequest | null)?.status === "stable") {
        toast.add({
          title: "Promoted to stable!",
          description: `'${pkgname}' now has both approvals.`,
          type: "success",
        })
      } else {
        toast.add({
          title: "Approval recorded",
          description: `${role} approval added for '${pkgname}'.`,
          type: "success",
        })
      }
      onChanged()
    } catch (err) {
      toast.add({
        title: "Promotion approval failed",
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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Unstable → stable promotion</CardTitle>
          <CardDescription>
            Needs both a maintainer and a user approval to move to the stable
            channel. Adding the second approval promotes it automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {unstable.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No packages awaiting promotion.
            </p>
          )}
          {unstable.map((item) => (
            <Collapsible
              key={item.pkgname}
              className="rounded-lg border"
            >
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-2">
                  <CollapsibleTrigger
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "size-7 shrink-0 transition-transform data-[panel-open]:rotate-90"
                    )}
                    aria-label={`Toggle details for ${item.pkgname}`}
                  >
                    <ChevronRightIcon className="size-4 shrink-0" />
                  </CollapsibleTrigger>
                  <div className="flex flex-col gap-1.5">
                    <p className="font-medium">{item.pkgname}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                    <LifecycleStrip pkgname={item.pkgname} status={item.status} />
                  </div>
                </div>
                <div className="w-full sm:w-72">
                  <PromotionSlots
                    pkgname={item.pkgname}
                    maintainer={item.promotionMaintainer}
                    user={item.promotionUser}
                    pendingKey={pending}
                    onApprove={approve}
                  />
                </div>
              </div>
              <CollapsibleContent className="border-t bg-muted/30">
                <RequestDetailsPanel request={item} />
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {stable.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Promoted to stable</CardTitle>
            <CardDescription>
              Both approvals are present; these packages moved to the stable
              channel.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {stable.map((item) => (
              <Collapsible key={item.pkgname} className="rounded-lg border">
                <div className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "icon" }),
                        "size-7 shrink-0 transition-transform data-[panel-open]:rotate-90"
                      )}
                      aria-label={`Toggle details for ${item.pkgname}`}
                    >
                      <ChevronRightIcon className="size-4 shrink-0" />
                    </CollapsibleTrigger>
                    <span className="font-medium">{item.pkgname}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <SparklesIcon className="size-3" />
                      Promoted
                    </span>
                    <LifecycleStrip pkgname={item.pkgname} status={item.status} />
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>Maintainer: {item.promotionMaintainer?.by}</span>
                    <span>User: {item.promotionUser?.by}</span>
                  </div>
                </div>
                <CollapsibleContent className="border-t bg-muted/30">
                  <RequestDetailsPanel request={item} />
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
