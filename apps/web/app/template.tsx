"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type TemplateProps = {
  children: ReactNode;
};

const OUT_MS = 170;
const IN_MS = 230;

function isArchivePath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/campaigns") ||
    pathname.startsWith("/settings")
  );
}

type Mode = "archive" | "generic";

function resolveMode(pathname: string): Mode {
  return isArchivePath(pathname) ? "archive" : "generic";
}

export default function Template({ children }: TemplateProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/openalpha")) {
    return children;
  }

  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const [activePath, setActivePath] = useState(pathname);
  const [displayedChildren, setDisplayedChildren] = useState<ReactNode>(children);
  const [mode, setMode] = useState<Mode>(resolveMode(pathname));

  const outTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    return () => {
      if (outTimerRef.current) clearTimeout(outTimerRef.current);
      if (inTimerRef.current) clearTimeout(inTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      setDisplayedChildren(children);
      setActivePath(pathname);
      setMode(resolveMode(pathname));
      return;
    }

    if (pathname === activePath) {
      setDisplayedChildren(children);
      return;
    }

    if (outTimerRef.current) clearTimeout(outTimerRef.current);
    if (inTimerRef.current) clearTimeout(inTimerRef.current);

    setPhase("out");
    outTimerRef.current = setTimeout(() => {
      setDisplayedChildren(children);
      setActivePath(pathname);
      setMode(resolveMode(pathname));
      setPhase("in");

      inTimerRef.current = setTimeout(() => {
        setPhase("idle");
      }, IN_MS);
    }, OUT_MS);
  }, [activePath, children, hydrated, pathname]);

  const phaseClass = !hydrated
    ? "route-template-hydrating"
    : phase === "out"
      ? "route-template-out"
      : phase === "in"
        ? "route-template-in"
        : "route-template-idle";

  return <div className={`route-template-layer route-template-${mode} ${phaseClass}`}>{displayedChildren}</div>;
}
