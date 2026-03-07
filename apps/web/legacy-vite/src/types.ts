export type RecapType = 'concise' | 'balanced' | 'detailed';

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
}

export interface Session {
  id: string;
  title: string;
  date: string;
  recaps: {
    concise: string;
    balanced: string;
    detailed: string;
  };
  transcript: TranscriptEntry[];
  status: 'completed' | 'in-progress';
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  sessions: Session[];
}
