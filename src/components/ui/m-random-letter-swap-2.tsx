import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface RandomLetterSwapProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  isActive?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost";
  speed?: number;
}

const CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * RandomLetterSwapButton
 * Accessible button with a subtle scrambled letter swap animation on hover/focus.
 * Automatically respects `prefers-reduced-motion` and keyboard accessibility.
 */
export function RandomLetterSwap({
  text,
  isActive = false,
  icon,
  badge,
  className,
  speed = 28,
  onClick,
  ...props
}: RandomLetterSwapProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    setDisplayText(text);
    if (typeof window !== "undefined") {
      prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  }, [text]);

  const startScramble = () => {
    if (prefersReducedMotion.current || isScrambling) return;
    setIsScrambling(true);

    let iteration = 0;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = window.setInterval(() => {
      setDisplayText(() => {
        return text
          .split("")
          .map((char, index) => {
            if (char === " " || char === "&" || char === "-" || char === "(" || char === ")") {
              return char;
            }
            if (index < iteration) {
              return text[index];
            }
            return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
          })
          .join("");
      });

      iteration += 1 / 2;

      if (iteration >= text.length) {
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setDisplayText(text);
        setIsScrambling(false);
      }
    }, speed);
  };

  const handleMouseEnter = () => {
    startScramble();
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <button
      type="button"
      onMouseEnter={handleMouseEnter}
      onFocus={startScramble}
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        "group relative flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 cursor-pointer select-none shrink-0 whitespace-nowrap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isActive
          ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
          : "bg-card text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border/70 hover:border-border",
        className
      )}
      {...props}
    >
      {icon && (
        <span
          className={cn(
            "transition-transform duration-200 group-hover:scale-110 shrink-0",
            isActive ? "text-primary-foreground" : "text-primary"
          )}
        >
          {icon}
        </span>
      )}
      <span className="font-mono tracking-tight text-left whitespace-nowrap">{displayText}</span>
      {badge && <span className="ml-1 shrink-0">{badge}</span>}
    </button>
  );
}

export default RandomLetterSwap;

