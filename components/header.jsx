import React from "react";
import { Button } from "./ui/button";
import { PenBox, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { checkUser } from "@/lib/checkUser";
import Image from "next/image";

const Header = async () => {
  await checkUser();

  return (
    <header
      className="fixed top-0 w-full backdrop-blur-md z-50 border-b border-slate-700/50"
      style={{ background: "oklch(0.15 0.08 240)" }} // Custom background
    >
      <nav className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/">
          <Image
            src={"/logo.png"}
            alt="FinScope Logo"
            width={800}
            height={200}
            className="h-27 w-auto object-contain"
          />
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center space-x-6">
          <SignedOut>
            <a href="#features" className="text-gray-300 hover:text-blue-400 transition-colors">
              Features
            </a>
            <a href="#testimonials" className="text-gray-300 hover:text-blue-400 transition-colors">
              Testimonials
            </a>
          </SignedOut>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <SignedIn>
            <Link
              href="/dashboard"
              className="text-gray-300 hover:text-blue-400 flex items-center gap-2 transition-colors"
            >
              <Button
                variant="outline"
                className="border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-blue-400 hover:border-blue-500 px-3 py-1"
              >
                <LayoutDashboard size={18} />
                <span className="hidden md:inline">Dashboard</span>
              </Button>
            </Link>

            <a href="/transaction/create">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-3 py-1 transition-colors">
                <PenBox size={18} />
                <span className="hidden md:inline">Add Transaction</span>
              </Button>
            </a>
          </SignedIn>

          <SignedOut>
            <SignInButton forceRedirectUrl="/dashboard">
              <Button
                variant="outline"
                className="border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-blue-400 hover:border-blue-500 px-3 py-1"
              >
                Login
              </Button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox:
                    "w-8 h-8 ring-2 ring-slate-600 hover:ring-blue-500 transition-all",
                  userButtonPopoverCard: "bg-slate-800 border-slate-700",
                  userButtonPopoverText: "text-slate-300",
                  userButtonPopoverActionButton:
                    "text-slate-300 hover:text-blue-400 hover:bg-slate-700",
                },
              }}
            />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
};

export default Header;
