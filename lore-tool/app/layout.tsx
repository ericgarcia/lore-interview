import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lore Belief Explorer",
  description: "Browse and evaluate self-belief extractions from conversational data",
};

const navLinks = [
  { href: "/", label: "Explorer" },
  { href: "/metrics", label: "Metrics" },
  { href: "/batch", label: "Batch Evaluate" },
  { href: "/proposals/categories", label: "Category Proposals" },
  { href: "/schema", label: "Schema" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="shrink-0 border-b border-[#2e3350] bg-[#12141e]">
          <div className="flex items-center gap-6 px-6 h-12">
            <span className="text-sm font-semibold text-[#e8eaf0] tracking-tight">
              Lore Belief Explorer
            </span>
            <nav className="flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="px-3 py-1.5 rounded text-xs text-[#9ca3af] hover:text-[#e8eaf0] hover:bg-[#22263a] transition-colors"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
