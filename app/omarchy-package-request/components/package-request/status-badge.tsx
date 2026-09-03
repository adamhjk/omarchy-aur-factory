import { Badge } from "@/components/ui/badge"
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

const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  unstable: "Unstable",
  stable: "Stable",
  rejected: "Rejected",
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}
