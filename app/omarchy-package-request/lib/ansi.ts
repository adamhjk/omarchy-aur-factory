import Anser from "anser"

/** Escapes HTML-significant characters so text is safe to inject as HTML. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Renders raw terminal/log output (packager stage logs, build logs) as safe,
 * colored HTML: the input is HTML-escaped first, then ANSI SGR escape codes
 * are converted to inline-styled `<span>` elements by anser. Escaping must
 * happen *before* anser runs, so any literal HTML captured in a log (e.g. a
 * tool echoing a `<script>` tag) can't be interpreted as markup once the
 * result is injected via `dangerouslySetInnerHTML`; anser's own output spans
 * are trusted, generated HTML and are not re-escaped.
 */
export function ansiLogToHtml(raw: string): string {
  return Anser.ansiToHtml(escapeHtml(raw), { use_classes: false })
}
