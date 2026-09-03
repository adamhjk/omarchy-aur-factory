"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

// The app is dark-first: the omarchy "searock" theme is the only supported
// mode for now, so the theme is forced rather than toggleable (no system
// detection, no light mode, no hotkey to switch away from it).
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
