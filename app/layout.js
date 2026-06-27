import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import Header from "@/components/header";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "FinScope - Smart Finance Tracking Platform",
  description: "One stop Finance Platform for managing your income, expenses, and savings with intelligence.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className={`${inter.className}`}>
          <Header />
          <main className="min-h-screen">{children}</main>
          <Toaster richColors />
          <footer className="bg-slate-900 border-t border-slate-800 py-12 text-center text-gray-400">
            <div className="container mx-auto px-4">
              <p>Made with 💙 by FinScope</p>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
