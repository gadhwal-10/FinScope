import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "FinScope",
  description: "Full Scope Of Your Finances",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <head>
          <link rel="icon" href="/logo-sm.png" sizes="any" />
        </head>
        <body
          className={`${inter.className} text-slate-100`}
          style={{ background: "oklch(0.15 0.08 240)" }}
          suppressHydrationWarning
        >
          <Header />

          <main className="min-h-screen">
            {children}
          </main>

          <Toaster 
            richColors 
            theme="dark"
            toastOptions={{
              style: {
                background: 'rgb(30 41 59)',
                border: '1px solid rgb(51 65 85)',
                color: 'rgb(226 232 240)',
              },
            }}
          />

          <footer
            className="py-12"
            style={{ background: "oklch(0.15 0.08 240)", borderTop: "1px solid rgb(51 65 85)" }}
          >
            <div className="container mx-auto px-4 text-center text-slate-300">
              <p className="flex items-center justify-center gap-2">
                Made with 
                <span className="text-red-400 animate-pulse">💗</span>
                <span className="text-blue-400 font-medium">for you</span>
              </p>
              <div className="mt-4 text-sm text-slate-400">
                <p>&copy; 2025 FinScope. All rights reserved.</p>
              </div>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
