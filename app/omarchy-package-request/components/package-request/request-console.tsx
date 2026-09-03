"use client"

import { useCallback, useEffect, useState } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PackageRequest } from "@/lib/swamp"

import { ApprovalQueueTab } from "./approval-queue-tab"
import { PromotionTab } from "./promotion-tab"
import { SubmitTab } from "./submit-tab"

const BUILD_POLL_INTERVAL_MS = 5000

async function fetchRequests(): Promise<PackageRequest[]> {
  const res = await fetch("/api/requests")
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to load requests (${res.status})`)
  }
  return body as PackageRequest[]
}

export function RequestConsole() {
  const [requests, setRequests] = useState<PackageRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRequests(await fetchRequests())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests")
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load: chain off the fetch promise (rather than calling the async
  // `refresh` directly) so no setState happens synchronously within the
  // effect body itself.
  useEffect(() => {
    let cancelled = false

    fetchRequests()
      .then((data) => {
        if (!cancelled) setRequests(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load requests")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The build workflow runs entirely server-side (spawned when a request is
  // approved, recording mark-built on success): once approved, keep
  // re-fetching the list so an in-progress build's row picks up its status
  // change (approved -> unstable) and moves to the Promotion tab without
  // requiring a page reload.
  useEffect(() => {
    if (!requests.some((item) => item.status === "approved")) return

    const timer = setInterval(() => {
      refresh()
    }, BUILD_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [requests, refresh])

  return (
    <Tabs defaultValue="submit" className="w-full max-w-4xl">
      <TabsList className="mx-auto flex w-fit">
        <TabsTrigger value="submit">Submit</TabsTrigger>
        <TabsTrigger value="approval">Approval queue</TabsTrigger>
        <TabsTrigger value="promotion">Promotion</TabsTrigger>
      </TabsList>
      <TabsContent value="submit">
        <SubmitTab onSubmitted={refresh} />
      </TabsContent>
      <TabsContent value="approval">
        <ApprovalQueueTab
          requests={requests}
          loading={loading}
          error={error}
          onChanged={refresh}
        />
      </TabsContent>
      <TabsContent value="promotion">
        <PromotionTab
          requests={requests}
          loading={loading}
          error={error}
          onChanged={refresh}
        />
      </TabsContent>
    </Tabs>
  )
}
