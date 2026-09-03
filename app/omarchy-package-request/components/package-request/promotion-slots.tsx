"use client"

import { CheckCircle2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress"
import { cn, formatTimestamp } from "@/lib/utils"
import type { ApprovalRecord, PromotionRole } from "@/lib/swamp"

interface SlotProps {
  label: string
  role: PromotionRole
  approval: ApprovalRecord
  pkgname: string
  pending: boolean
  onApprove: (pkgname: string, role: PromotionRole) => void
}

function Slot({ label, role, approval, pkgname, pending, onApprove }: SlotProps) {
  const filled = Boolean(approval)
  return (
    <div
      className={cn(
        "flex min-w-40 flex-1 flex-col gap-1.5 rounded-lg border p-3",
        filled ? "border-primary/40 bg-primary/5" : "border-dashed"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {filled && <CheckCircle2Icon className="size-4 shrink-0 text-primary" />}
      </div>
      {approval ? (
        <div className="text-sm">
          <p className="font-medium">{approval.by}</p>
          <p className="text-xs text-muted-foreground">{formatTimestamp(approval.at)}</p>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onApprove(pkgname, role)}
        >
          Approve as {label.toLowerCase()}
        </Button>
      )}
    </div>
  )
}

/**
 * Two-slot promotion progress (Maintainer, User) for an unstable package:
 * each slot is either filled (who + when + check) or pending (approve
 * button), plus an N of 2 progress indicator.
 */
export function PromotionSlots({
  pkgname,
  maintainer,
  user,
  pendingKey,
  onApprove,
}: {
  pkgname: string
  maintainer: ApprovalRecord
  user: ApprovalRecord
  pendingKey: string | null
  onApprove: (pkgname: string, role: PromotionRole) => void
}) {
  const filledCount = [maintainer, user].filter(Boolean).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Promotion progress
        </span>
        <span className="text-xs font-medium text-muted-foreground">{filledCount} of 2</span>
      </div>
      <Progress value={(filledCount / 2) * 100}>
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
      <div className="flex flex-wrap gap-2">
        <Slot
          label="Maintainer"
          role="maintainer"
          approval={maintainer}
          pkgname={pkgname}
          pending={pendingKey === `${pkgname}:maintainer`}
          onApprove={onApprove}
        />
        <Slot
          label="User"
          role="user"
          approval={user}
          pkgname={pkgname}
          pending={pendingKey === `${pkgname}:user`}
          onApprove={onApprove}
        />
      </div>
    </div>
  )
}
