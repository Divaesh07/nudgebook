import type { Metadata, Viewport } from "next";
import { Geist, Lora } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Nudgebook",
  description: "Log what you did. Get nudged when it's due again.",
  appleWebApp: { capable: true, title: "Nudgebook", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffbeb" },
    { media: "(prefers-color-scheme: dark)", color: "#15110e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${lora.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans text-base">{children}</body>
    </html>
  );
}
