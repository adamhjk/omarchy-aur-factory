import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formats an ISO timestamp for display, falling back to the raw string if unparsable. */
export function formatTimestamp(at: string): string {
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return at
  return parsed.toLocaleString()
}
