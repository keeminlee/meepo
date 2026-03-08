import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowRight, BookOpen, Star, Map as MapIcon } from 'lucide-react';
import CelestialHeroBackground from './ui/celestial-hero-background';

interface LandingPageProps {
  onStart: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  return (
    <div className="relative min-h-screen selection:bg-primary/30">
      <CelestialHeroBackground className="fixed inset-0 z-0" />
      
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-screen px-6 text-center z-10">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10"
        >
          <div className="flex items-center justify-center mb-6 space-x-2">
            <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            <span className="text-sm font-medium tracking-widest uppercase text-primary/80">The Celestial Archive</span>
          </div>
          
          <h1 className="mb-6 text-7xl md:text-9xl font-serif italic tracking-tight text-foreground">
            Meepo
          </h1>
          
          <p className="max-w-2xl mx-auto mb-10 text-xl md:text-2xl font-light leading-relaxed text-muted-foreground">
            A Living Chronicle of Adventures.
            <span className="block mt-2 text-foreground/80">Every session leaves a star behind. Meepo preserves the story of your campaign as it unfolds.</span>
          </p>

          <div className="flex flex-col items-center justify-center space-y-4 sm:flex-row sm:space-y-0 sm:space-x-6">
            <button
              onClick={onStart}
              className="px-8 py-4 text-lg font-semibold rounded-full button-primary group"
            >
              <span className="flex items-center">
                Start Your Chronicle
                <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
            <button className="px-8 py-4 text-lg font-medium transition-colors border rounded-full border-border hover:bg-white/5 text-foreground/80">
              Learn More
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce"
        >
          <div className="w-px h-12 bg-gradient-to-b from-primary/50 to-transparent" />
        </motion.div>
      </section>

      {/* Features Sections */}
      <div className="relative z-10 max-w-6xl mx-auto space-y-32 py-32 px-6">
        {/* Section 1 */}
        <motion.section 
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="grid items-center gap-12 md:grid-cols-2"
        >
          <div>
            <div className="inline-flex items-center px-3 py-1 mb-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider">
              Preservation
            </div>
            <h2 className="mb-6 text-4xl md:text-5xl font-serif text-foreground">Every Session Becomes a Memory</h2>
            <p className="mb-8 text-lg text-muted-foreground leading-relaxed">
              When a session ends, Meepo captures the moment. Transcripts and recaps become part of your campaign’s living chronicle, forever etched in the stars.
            </p>
            <ul className="space-y-4">
              {[
                { icon: BookOpen, text: "Session transcripts preserved in detail" },
                { icon: Star, text: "Multiview recaps for every playstyle" },
                { icon: Sparkles, text: "A growing campaign history at your fingertips" }
              ].map((item, i) => (
                <li key={i} className="flex items-center text-foreground/80">
                  <item.icon className="w-5 h-5 mr-3 text-primary/60" />
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative aspect-square rounded-2xl overflow-hidden card-glass p-8 flex items-center justify-center">
             <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--color-primary)_0%,_transparent_70%)]" />
             <div className="relative z-10 w-full h-full border border-dashed border-primary/30 rounded-full animate-[spin_20s_linear_infinite] flex items-center justify-center">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full shadow-[0_0_15px_var(--color-primary)]" />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-primary/60 rounded-full" />
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary/60 rounded-full" />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary/60 rounded-full" />
             </div>
             <div className="absolute z-20 text-primary/40 font-serif italic text-xl">Constellation Diagram</div>
          </div>
        </motion.section>

        {/* Section 2 */}
        <motion.section 
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="grid items-center gap-12 md:grid-cols-2"
        >
          <div className="order-2 md:order-1 relative aspect-video rounded-xl overflow-hidden card-glass border-bronze/30 shadow-2xl">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-red-500/50" />
              <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
              <div className="w-2 h-2 rounded-full bg-green-500/50" />
              <div className="ml-4 h-4 w-32 bg-border/50 rounded" />
            </div>
            <div className="p-6 space-y-4">
              <div className="flex space-x-2 mb-6">
                <div className="px-3 py-1 rounded bg-primary/20 text-[10px] text-primary font-bold uppercase">Concise</div>
                <div className="px-3 py-1 rounded bg-muted text-[10px] text-muted-foreground font-bold uppercase">Balanced</div>
                <div className="px-3 py-1 rounded bg-muted text-[10px] text-muted-foreground font-bold uppercase">Detailed</div>
              </div>
              <div className="h-4 w-3/4 bg-foreground/10 rounded" />
              <div className="h-4 w-full bg-foreground/10 rounded" />
              <div className="h-4 w-5/6 bg-foreground/10 rounded" />
              <div className="pt-8 space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20" />
                  <div className="h-3 w-24 bg-primary/30 rounded" />
                </div>
                <div className="h-3 w-full bg-muted/50 rounded ml-11" />
              </div>
            </div>
          </div>
          <div className="order-1 md:order-2">
            <div className="inline-flex items-center px-3 py-1 mb-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider">
              Immersion
            </div>
            <h2 className="mb-6 text-4xl md:text-5xl font-serif text-foreground">Relive the Story</h2>
            <p className="mb-8 text-lg text-muted-foreground leading-relaxed">
              Return to any moment in your campaign. Read the raw transcript or explore layered recaps that reveal the shape of the story.
            </p>
            <div className="p-6 rounded-xl bg-muted/20 border border-border italic text-foreground/70">
              "The recap panel should feel like reading a chronicle entry, preserved for generations to come."
            </div>
          </div>
        </motion.section>

        {/* Section 3 */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center px-3 py-1 mb-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider">
            Evolution
          </div>
          <h2 className="mb-6 text-4xl md:text-5xl font-serif text-foreground">Your Campaign, Remembered</h2>
          <p className="mb-12 text-lg text-muted-foreground leading-relaxed">
            As your campaign grows, its memories form patterns. Characters, places, and events will eventually connect into a living map of your story.
          </p>
          <div className="relative py-20">
             <div className="absolute inset-0 flex items-center justify-center">
                <MapIcon className="w-64 h-64 text-primary/5 opacity-20" />
             </div>
             <div className="relative z-10 grid grid-cols-3 gap-8">
                {[
                  { label: "Characters", val: "42" },
                  { label: "Locations", val: "18" },
                  { label: "Factions", val: "5" }
                ].map((stat, i) => (
                  <div key={i} className="p-6 rounded-2xl card-glass border-bronze/20">
                    <div className="text-3xl font-serif text-primary mb-1">{stat.val}</div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">{stat.label}</div>
                  </div>
                ))}
             </div>
          </div>
        </motion.section>
      </div>

      {/* Footer */}
      <footer className="relative z-10 py-20 border-t border-border text-center">
        <div className="flex items-center justify-center mb-6 space-x-2">
          <Sparkles className="w-5 h-5 text-primary/60" />
          <span className="text-xl font-serif italic text-foreground">Meepo</span>
        </div>
        <p className="text-sm text-muted-foreground">© 2026 The Celestial Archive. All rights reserved.</p>
      </footer>
    </div>
  );
};
