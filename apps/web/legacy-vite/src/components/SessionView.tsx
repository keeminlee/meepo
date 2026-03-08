import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  MessageSquare, 
  FileText, 
  Clock, 
  User, 
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Session, RecapType } from '../types';

interface SessionViewProps {
  session: Session;
  onBack: () => void;
}

export const SessionView: React.FC<SessionViewProps> = ({ session, onBack }) => {
  const [activeRecap, setActiveRecap] = useState<RecapType>('balanced');
  const [showTranscript, setShowTranscript] = useState(true);

  const recapTabs: { id: RecapType; label: string }[] = [
    { id: 'concise', label: 'Concise' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'detailed', label: 'Detailed' },
  ];

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" />
          Back to Campaign
        </button>
        <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>Recorded {session.date}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-5xl font-serif text-foreground italic">{session.title}</h1>
        <div className="flex items-center space-x-4 text-sm text-primary/60">
          <span>The Shattered Crown</span>
          <span className="w-1 h-1 rounded-full bg-primary/30" />
          <span>Session 07</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Recap Section */}
        <div className="lg:col-span-7 space-y-6">
          <div className="card-glass rounded-2xl overflow-hidden border-bronze/10">
            <div className="p-6 border-b border-border bg-muted/20 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-primary" />
                <h3 className="font-serif text-lg">The Chronicle Entry</h3>
              </div>
              <div className="flex p-1 bg-background/50 rounded-lg border border-border">
                {recapTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveRecap(tab.id)}
                    className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                      activeRecap === tab.id 
                        ? 'bg-primary text-primary-foreground shadow-lg' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeRecap}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="prose prose-invert max-w-none"
                >
                  <p className="text-lg leading-relaxed text-foreground/90 font-light italic">
                    {session.recaps[activeRecap]}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="px-8 py-4 bg-primary/5 border-t border-primary/10 flex items-center justify-between">
               <div className="flex items-center space-x-2 text-xs text-primary/70 font-medium">
                  <Sparkles className="w-3 h-3" />
                  <span>Meepo has preserved this memory with celestial precision.</span>
               </div>
               <button className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">Share Entry</button>
            </div>
          </div>
        </div>

        {/* Transcript Section */}
        <div className="lg:col-span-5 space-y-6">
          <div className="card-glass rounded-2xl border-bronze/10 flex flex-col h-[600px]">
            <div className="p-6 border-b border-border bg-muted/20 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-primary/70" />
                <h3 className="font-serif text-lg">Raw Transcript</h3>
              </div>
              <button 
                onClick={() => setShowTranscript(!showTranscript)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {session.transcript.map((entry, i) => (
                <div key={entry.id} className="space-y-1 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${entry.speaker === 'DM' ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                      <span className={`text-xs font-bold uppercase tracking-widest ${entry.speaker === 'DM' ? 'text-primary' : 'text-muted-foreground'}`}>
                        {entry.speaker}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed pl-4 border-l border-border/50 group-hover:border-primary/30 transition-colors">
                    {entry.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
