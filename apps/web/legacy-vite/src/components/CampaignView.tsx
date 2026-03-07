import React from 'react';
import { motion } from 'motion/react';
import { Calendar, Clock, FileText, CheckCircle2, ChevronRight, Star } from 'lucide-react';
import { Campaign, Session } from '../types';

interface CampaignViewProps {
  campaign: Campaign;
  onSelectSession: (session: Session) => void;
}

export const CampaignView: React.FC<CampaignViewProps> = ({ campaign, onSelectSession }) => {
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="text-4xl font-serif text-foreground">{campaign.name}</h1>
        <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
          {campaign.description}
        </p>
      </header>

      <div className="grid gap-6">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80 flex items-center">
          <Star className="w-3 h-3 mr-2 fill-primary" />
          The Chronicle of Stars
        </h3>
        
        <div className="grid gap-4">
          {campaign.sessions.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onSelectSession(session)}
              className="group relative p-6 rounded-xl card-glass border-bronze/20 hover:border-primary/40 transition-all cursor-pointer overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-5 h-5 text-primary" />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-[10px] font-bold text-primary uppercase tracking-wider border border-primary/20">
                      Session {index + 1}
                    </span>
                    <h4 className="text-xl font-serif text-foreground group-hover:text-primary transition-colors">
                      {session.title}
                    </h4>
                  </div>
                  
                  <div className="flex items-center space-x-6 text-sm text-muted-foreground">
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-2 opacity-60" />
                      {session.date}
                    </div>
                    <div className="flex items-center">
                      <CheckCircle2 className="w-4 h-4 mr-2 text-green-500/60" />
                      Transcript Ready
                    </div>
                    <div className="flex items-center">
                      <FileText className="w-4 h-4 mr-2 text-blue-500/60" />
                      Recaps Generated
                    </div>
                  </div>
                </div>

                <div className="hidden md:block">
                   <div className="flex -space-x-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="w-8 h-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-bold">
                          {String.fromCharCode(64 + i)}
                        </div>
                      ))}
                   </div>
                </div>
              </div>

              {/* Subtle star glow on hover */}
              <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-all" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
