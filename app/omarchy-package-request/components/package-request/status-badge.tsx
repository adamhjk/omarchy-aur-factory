import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { RequestStatus } from "@/lib/swamp"

const STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  requested: "secondary",
  approved: "outline",
  unstable: "outline",
  stable: "default",
  rejected: "destructive",
}

// Status progression draws from the theme's chart hues so each stage reads
// distinctly against the dark ground: requested stays neutral (secondary),
// approved/unstable borrow the blue/yellow chart hues as "in progress"
// signals, stable lands on the green chart hue, and rejected keeps the
// destructive (bright_red) variant.
const STATUS_CLASSNAME: Partial<Record<RequestStatus, string>> = {
  approved: "border-transparent bg-chart-3/15 text-chart-3",
  unstable: "border-transparent bg-chart-5/15 text-chart-5",
  stable: "border-transparent bg-chart-1/15 text-chart-1",
}

const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  unstable: "Unstable",
  stable: "Stable",
  rejected: "Rejected",
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn(STATUS_CLASSNAME[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}
