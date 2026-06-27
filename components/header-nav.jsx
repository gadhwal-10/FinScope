import React from "react";
import Link from "next/link";
import { checkUser } from "@/lib/checkUser";
import Image from "next/image";
import HeaderNav from "./header-nav";

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

        <HeaderNav />
      </nav>
    </header>
  );
};

export default Header;
