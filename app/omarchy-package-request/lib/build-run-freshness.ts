/**
 * Whether a build run's startedAt predates a retry that was just triggered
 * on the client, within an allowed clock-skew tolerance. A stale run
 * belongs to the previous attempt (its startedAt was recorded before the
 * retry fired) and must not be rendered as though it's the new one -- the
 * UI should keep showing a "starting new build" state until a run that
 * actually started at/after the retry shows up.
 */
export function isStaleRun(
  runStartedAt: string,
  retryAt: number,
  clockSkewMs = 5000
): boolean {
  const runStarted = new Date(runStartedAt).getTime()
  if (Number.isNaN(runStarted)) return false
  return runStarted < retryAt - clockSkewMs
}
