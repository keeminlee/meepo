"use client";

import { useState } from "react";
import type { RecapTab, SessionRecap } from "@/lib/types";

const TABS: Array<{ id: RecapTab; label: string }> = [
  { id: "concise", label: "Concise" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];

type RecapTabsProps = {
  recap: SessionRecap;
};

export function RecapTabs({ recap }: RecapTabsProps) {
  const [activeTab, setActiveTab] = useState<RecapTab>("balanced");

  return (
    <div className="rounded-2xl card-glass">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-serif text-lg">Recap</h3>
        <div className="flex rounded-lg border border-border bg-background/50 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-6">
        <p className="text-lg italic leading-relaxed text-foreground/90">{recap[activeTab]}</p>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Generated {new Date(recap.generatedAt).toLocaleString()} / {recap.modelVersion}
        </div>
      </div>
    </div>
  );
}
