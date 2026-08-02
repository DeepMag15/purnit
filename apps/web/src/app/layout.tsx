import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ToastProvider } from "../ui/Toast";
import { QueryClientProvider } from "../lib/query-client-provider";
import "./globals.css";

// next/font/google self-hosts at build time (no runtime Google Fonts <link>,
// no render-blocking external request) — deliberate, since a live CDN font
// pull would directly undercut the parallel performance-optimization effort.
// Material Symbols isn't in next/font/google's catalog at all (confirmed —
// it's not a "text" font Next indexes); it's self-hosted separately via the
// `material-symbols` npm package's own static woff2 + CSS, imported in
// globals.css, which the bundler resolves at build time the same way.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata = {
  title: "Antigravity",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <QueryClientProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
