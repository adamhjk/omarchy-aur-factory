import * as React from "react"

import { ExternalLinkIcon, SparklesIcon } from "lucide-react"

import { cn, formatTimestamp } from "@/lib/utils"
import type { PackageRequest } from "@/lib/swamp"

import { BuildReportSection } from "./build-report-section"
import { BuildSection } from "./build-section"

function DetailField({
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

/**
 * Full-detail view of a package request, shown in the expanded panel of a
 * request row in both the Approval queue and Promotion tabs.
 */
export function RequestDetailsPanel({ request }: { request: PackageRequest }) {
  const hasPromotionApprovals =
    Boolean(request.promotionMaintainer) || Boolean(request.promotionUser)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <DetailField label="Description">{request.description}</DetailField>
        </div>
        <DetailField label="Source URL">
          <a
            href={request.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:no-underline"
          >
            {request.url}
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        </DetailField>
        <DetailField label="License">{request.license}</DetailField>
        <DetailField label="Submitter">{request.submittedBy}</DetailField>
        {request.version && (
          <DetailField label="Built version">{request.version}</DetailField>
        )}
        {request.rejectionReason && (
          <DetailField label="Rejection reason">
            {request.rejectionReason}
          </DetailField>
        )}
      </div>

      {request.status === "approved" && (
        <BuildSection pkgname={request.pkgname} />
      )}

      {(request.status === "unstable" || request.status === "stable") && (
        <BuildReportSection pkgname={request.pkgname} />
      )}

      {hasPromotionApprovals && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Promotion approvals
          </span>
          <div className="flex flex-col gap-1 text-sm">
            {request.promotionMaintainer && (
              <span>
                Maintainer: {request.promotionMaintainer.by} —{" "}
                {formatTimestamp(request.promotionMaintainer.at)}
              </span>
            )}
            {request.promotionUser && (
              <span>
                User: {request.promotionUser.by} —{" "}
                {formatTimestamp(request.promotionUser.at)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          History
        </span>
        {request.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history recorded.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l pl-3">
            {request.history.map((entry, index) => {
              const isPromoted = entry.event === "promoted"
              return (
                <li
                  key={`${entry.at}-${index}`}
                  className={cn(
                    "text-sm",
                    isPromoted && "-ml-3 rounded-md bg-primary/10 p-2 pl-3"
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {isPromoted && (
                      <SparklesIcon className="size-3.5 shrink-0 self-center text-primary" />
                    )}
                    <span
                      className={cn(
                        "font-medium",
                        isPromoted && "text-primary"
                      )}
                    >
                      {isPromoted ? "Promoted to stable" : entry.event}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(entry.at)}
                    </span>
                    {entry.by && (
                      <span className="text-xs text-muted-foreground">
                        by {entry.by}
                      </span>
                    )}
                  </div>
                  {entry.detail && (
                    <p className="text-xs text-muted-foreground">
                      {entry.detail}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
