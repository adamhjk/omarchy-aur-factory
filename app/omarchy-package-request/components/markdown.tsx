import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const components: Components = {
  h1: ({ className, ...props }) => (
    <h1
      className={cn("mt-4 mb-2 text-lg font-semibold text-bright-foreground first:mt-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mt-4 mb-2 text-base font-semibold text-bright-foreground first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mt-3 mb-1.5 text-sm font-semibold text-bright-foreground first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mt-3 mb-1.5 text-sm font-semibold text-bright-foreground first:mt-0",
        className
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-2 leading-relaxed last:mb-0", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("text-primary underline underline-offset-2 hover:no-underline", className)}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold text-bright-foreground", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("mb-2 list-disc space-y-0.5 pl-5 last:mb-0", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("mb-2 list-decimal space-y-0.5 pl-5 last:mb-0", className)} {...props} />
  ),
  li: ({ className, ...props }) => <li className={cn("leading-relaxed", className)} {...props} />,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => <hr className={cn("my-4 border-border", className)} {...props} />,
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "mb-2 overflow-auto rounded-md border border-border bg-well p-3 text-xs last:mb-0",
        className
      )}
      {...props}
    />
  ),
  code: ({ className, ...props }) => (
    <code
      className={cn(
        "font-mono text-[0.85em]",
        // Fenced code blocks carry a `language-*` class from remark-gfm and
        // already sit inside a `bg-well` <pre>; only pill-style bare inline
        // code so block code doesn't get a redundant nested background.
        className || "rounded-sm bg-well px-1 py-0.5"
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="mb-2 rounded-md border border-border last:mb-0">
      <Table className={className} {...props} />
    </div>
  ),
  thead: (props) => <TableHeader {...props} />,
  tbody: (props) => <TableBody {...props} />,
  tr: (props) => <TableRow {...props} />,
  th: (props) => <TableHead {...props} />,
  td: ({ className, ...props }) => (
    <TableCell className={cn("whitespace-normal", className)} {...props} />
  ),
}

/**
 * Renders GFM markdown (packager dossiers, which include tables) using the
 * app's theme tokens instead of the browser's default prose styling: deep
 * wells for code blocks, bright foreground for headings, border tokens for
 * table rules.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
