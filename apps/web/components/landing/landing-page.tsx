import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles, Star } from "lucide-react";
import type { ComponentType } from "react";

type LandingFeature = {
  icon: ComponentType<{ className?: string }>;
  text: string;
};

type LandingPageProps = {
  features: LandingFeature[];
};

export function LandingPage(props: LandingPageProps) {
  return (
    <div className="relative min-h-screen selection:bg-primary/30">
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="flex items-center justify-center space-x-2">
          <Sparkles className="h-6 w-6 animate-pulse text-primary" />
          <span className="text-sm uppercase tracking-widest text-primary/80">The Celestial Archive</span>
        </div>
        <h1 className="mt-6 text-7xl font-serif italic tracking-tight md:text-9xl">Meepo</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-2xl">
          A living chronicle of D&D adventures. Every session leaves a star behind.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Link href="/dashboard" className="button-primary rounded-full px-8 py-4 text-lg font-semibold">
            <span className="inline-flex items-center">
              Start Your Chronicle
              <ArrowRight className="ml-2 h-5 w-5" />
            </span>
          </Link>
          <a href="#features" className="rounded-full border border-border px-8 py-4 text-lg text-foreground/80 hover:bg-white/5">
            Learn More
          </a>
        </div>
      </section>

      <section id="features" className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-2xl card-glass p-8">
          <h2 className="text-3xl font-serif">What You Can See Today</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {props.features.map((feature) => (
              <li key={feature.text} className="rounded-xl border border-border bg-muted/20 p-4 text-left">
                <feature.icon className="h-5 w-5 text-primary/70" />
                <p className="mt-3 text-sm text-foreground/85">{feature.text}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="mr-2 inline-flex items-center"><Star className="mr-1 h-3 w-3 fill-primary text-primary" />Dark Chronicle Shell</span>
            <span className="mr-2">Celestial Landing</span>
            <span>Stable Theme Tokens</span>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border py-10 text-center text-sm text-muted-foreground">
        Meepo Archive Viewer - Track B Shell
      </footer>
    </div>
  );
}

export const LANDING_FEATURES: LandingFeature[] = [
  { icon: BookOpen, text: "Session transcripts preserved in detail" },
  { icon: Star, text: "Multiview recaps for every playstyle" },
  { icon: Sparkles, text: "A growing campaign history at your fingertips" },
];
