"use client";

import { useEffect } from "react";

type RouteErrorProps = {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
};

export function RouteError({ title, error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error(`[web-route-error] ${title}:`, error);
  }, [error, title]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-xl rounded-2xl card-glass p-8 text-center">
        <h2 className="text-2xl font-serif italic">{title}</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          The archive hit a route-level error. Retry this view, then check server logs if it persists.
        </p>
        <button onClick={reset} className="mt-6 rounded-full button-primary px-5 py-2 text-xs font-bold uppercase tracking-widest">
          Retry
        </button>
      </div>
    </div>
  );
}
