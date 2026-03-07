import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LandingPage } from './components/LandingPage';
import { AppShell } from './components/AppShell';
import { CampaignView } from './components/CampaignView';
import { SessionView } from './components/SessionView';
import { MOCK_CAMPAIGN } from './mockData';
import { Session } from './types';

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('campaigns');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // Simple routing logic
  const renderContent = () => {
    if (selectedSession) {
      return (
        <SessionView 
          session={selectedSession} 
          onBack={() => setSelectedSession(null)} 
        />
      );
    }

    switch (activeTab) {
      case 'campaigns':
        return (
          <CampaignView 
            campaign={MOCK_CAMPAIGN} 
            onSelectSession={(s) => setSelectedSession(s)} 
          />
        );
      case 'dashboard':
        return (
          <div className="space-y-8">
            <h1 className="text-4xl font-serif text-foreground">Dashboard</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Total Sessions', value: '12', icon: '✨' },
                { label: 'Campaigns', value: '1', icon: '🗺️' },
                { label: 'Words Recorded', value: '45,281', icon: '✍️' }
              ].map((stat, i) => (
                <div key={i} className="p-6 rounded-2xl card-glass border-bronze/10">
                  <div className="text-2xl mb-2">{stat.icon}</div>
                  <div className="text-3xl font-bold text-primary">{stat.value}</div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
            
            <div className="p-8 rounded-2xl card-glass border-bronze/10 bg-primary/5">
               <h3 className="text-xl font-serif text-foreground mb-4 italic">Welcome back, Adventurer.</h3>
               <p className="text-muted-foreground leading-relaxed">
                 The stars have shifted since your last visit. Your campaign "The Shattered Crown" has 2 new memories waiting to be explored.
               </p>
               <button 
                 onClick={() => setActiveTab('campaigns')}
                 className="mt-6 px-6 py-2 rounded-full button-primary text-sm font-bold uppercase tracking-widest"
               >
                 Continue Journey
               </button>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl">
              🔭
            </div>
            <h2 className="text-2xl font-serif italic">This part of the sky is still dark.</h2>
            <p className="text-muted-foreground max-w-md">
              We are currently charting this section of the archive. Check back soon as the chronicle expands.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <AnimatePresence mode="wait">
        {!hasStarted ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5 }}
          >
            <LandingPage onStart={() => setHasStarted(true)} />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <AppShell 
              activeTab={activeTab} 
              setActiveTab={(tab) => {
                setActiveTab(tab);
                setSelectedSession(null);
              }}
              onLogout={() => setHasStarted(false)}
            >
              {renderContent()}
            </AppShell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
