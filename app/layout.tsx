import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Anker · Company Portal",
  description: "Platform administration for Anker Venture OS. Internal use only.",
  robots: { index: false, follow: false },
}

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#17181c" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
