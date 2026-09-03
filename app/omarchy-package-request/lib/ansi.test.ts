import { describe, expect, it } from "vitest"

import { ansiLogToHtml, escapeHtml } from "./ansi"

const ESC = ""

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x & 'y'")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;"
    )
  })

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Building package entr-5.6-1")).toBe("Building package entr-5.6-1")
  })
})

describe("ansiLogToHtml", () => {
  it("escapes raw HTML in the log before any ANSI processing", () => {
    const html = ansiLogToHtml(`<img src=x onerror=alert(1)>`)

    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })

  it("converts ANSI SGR color codes into styled spans", () => {
    const html = ansiLogToHtml(`${ESC}[32mBUILD OK${ESC}[0m`)

    expect(html).toContain("<span")
    expect(html).toContain("BUILD OK")
    expect(html).toMatch(/style="[^"]*color:rgb\(0,\s?187,\s?0\)/)
  })

  it("escapes HTML embedded inside an ANSI-colored segment", () => {
    const html = ansiLogToHtml(`${ESC}[31m<b>danger</b>${ESC}[0m`)

    expect(html).not.toContain("<b>danger</b>")
    expect(html).toContain("&lt;b&gt;danger&lt;/b&gt;")
    expect(html).toContain("<span")
  })

  it("passes plain text through without adding markup", () => {
    expect(ansiLogToHtml("no colors here")).toBe("no colors here")
  })
})
