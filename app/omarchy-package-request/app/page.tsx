import { OmarchyLogo } from "@/components/omarchy-logo"
import { RequestConsole } from "@/components/package-request/request-console"

export default function Page() {
  return (
    <div className="flex min-h-svh justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <div>
          <div className="flex items-center gap-2 sm:gap-3">
            <OmarchyLogo className="h-[22px] w-auto shrink-0 text-foreground sm:h-7" />
            <h1 className="text-xl font-medium sm:text-2xl">Package Requests</h1>
          </div>
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
