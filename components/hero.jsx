"use client";

import React, { useEffect, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const HeroSection = () => {
  const imageRef = useRef(null);

  useEffect(() => {
    const imageElement = imageRef.current;

    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      const scrollThreshold = 100;

      if (scrollPosition > scrollThreshold) {
        imageElement.classList.add("scrolled");
      } else {
        imageElement.classList.remove("scrolled");
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <section
      className="pt-32 md:pt-40 pb-20 px-4 min-h-screen"
      style={{ background: "oklch(0.15 0.08 240)" }}
    >
      <div className="container mx-auto text-center">
        <h1 className="text-5xl md:text-8xl lg:text-[105px] pb-6 gradient-title bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent font-bold">
          Full Scope Of Your Finances <br /> with Intelligence
        </h1>

        <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto leading-relaxed">
          FinScope is a smart finance tracking platform that gives you a complete view of your income, expenses, and savings. It helps you categorize transactions, monitor spending patterns, and set financial goals with ease.
          <br /><br />
          With FinScope, you gain full control and clarity over your money—empowering smarter decisions for a secure financial future.
        </p>

        <div className="flex justify-center space-x-4">
          <Link href="/dashboard">
            <Button 
              size="lg" 
              className="px-8 bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              Get Started
            </Button>
          </Link>
        </div>

        {/* Gap added here */}
        <div className="hero-image-wrapper mt-12 md:mt-16">
          <div ref={imageRef} className="hero-image">
            <Image
              src="/banner.jpg"
              width={3000}
              height={200}
              alt="Dashboard Preview"
              className="rounded-lg shadow-2xl border border-slate-700/50 mx-auto hover:shadow-blue-500/20 transition-shadow duration-500"
              priority
            />
          </div>
        </div>
      </div>

      {/* Additional styling for the scrolled effect */}
      <style jsx>{`
        .hero-image-wrapper {
          perspective: 1000px;
        }

        .hero-image {
          transition: transform 0.6s ease-out;
        }

        .hero-image.scrolled {
          transform: rotateX(5deg) translateY(-10px);
        }

        .gradient-title {
          text-shadow: 0 0 30px rgba(59, 130, 246, 0.3);
        }
      `}</style>
    </section>
  );
};

export default HeroSection;
