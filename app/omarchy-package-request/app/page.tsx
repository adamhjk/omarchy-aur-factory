import { RequestConsole } from "@/components/package-request/request-console"

export default function Page() {
  return (
    <div className="flex min-h-svh justify-center p-6">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-medium">Omarchy package requests</h1>
          <p className="text-sm text-muted-foreground">
            Submit new AUR package requests, review the approval queue, and
            promote unstable packages to the stable channel.
          </p>
        </div>
        <RequestConsole />
      </div>
    </div>
  )
}
