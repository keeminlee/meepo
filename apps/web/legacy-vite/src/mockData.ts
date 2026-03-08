import { Campaign } from './types';

export const MOCK_CAMPAIGN: Campaign = {
  id: 'c1',
  name: 'The Shattered Crown',
  description: 'A journey through the frozen wastes of the North to recover the fragments of the ancient crown.',
  sessions: [
    {
      id: 's1',
      title: 'The Frozen Pass',
      date: '2026-01-14',
      status: 'completed',
      recaps: {
        concise: 'The party successfully crossed the pass, defeating a group of ice mephits.',
        balanced: 'After a grueling three-day climb, the party reached the summit of the Frozen Pass. They were ambushed by ice mephits but managed to drive them off. Kaelen found a mysterious silver locket in the snow.',
        detailed: 'The session began with the party at the base of the Frozen Pass. The weather was worsening. Kaelen led the way, using his survival skills to find a safe path. Around midday, they were attacked by four ice mephits. The battle was brief but intense; Elara used a well-placed Fireball to clear the cluster. After the fight, they rested near a rocky outcropping. Kaelen noticed something glinting in the snow—a silver locket with a faded portrait inside. They reached the other side of the pass by nightfall.'
      },
      transcript: [
        { id: 't1', speaker: 'DM', text: 'The wind howls around you as you reach the narrowest part of the pass.', timestamp: '00:05' },
        { id: 't2', speaker: 'Kaelen', text: 'I check the ground for any signs of recent passage.', timestamp: '00:07' },
        { id: 't3', speaker: 'DM', text: 'Roll for Survival.', timestamp: '00:08' },
        { id: 't4', speaker: 'Kaelen', text: 'That\'s a 19.', timestamp: '00:10' },
        { id: 't5', speaker: 'DM', text: 'You see faint tracks, mostly covered by fresh snow, but they look... small. And numerous.', timestamp: '00:12' }
      ]
    },
    {
      id: 's2',
      title: 'The Whispering Woods',
      date: '2026-01-21',
      status: 'completed',
      recaps: {
        concise: 'Entered the woods, met a strange hermit, and found the first fragment.',
        balanced: 'The party entered the Whispering Woods. They encountered a hermit named Silas who gave them a riddle. Solving it led them to an ancient altar where the first fragment of the crown was hidden.',
        detailed: 'The Whispering Woods lived up to their name; the trees seemed to murmur as the party passed. They met Silas, a half-elf hermit who has lived there for decades. Silas tested them with a riddle about time. Elara solved it instantly. Silas then pointed them toward the Altar of Echoes. At the altar, they faced a spectral guardian. After defeating the guardian, the altar opened, revealing the First Fragment—a shard of pure sapphire.'
      },
      transcript: [
        { id: 't6', speaker: 'Silas', text: 'Few come this deep into the whispers. What do you seek?', timestamp: '00:45' },
        { id: 't7', speaker: 'Elara', text: 'We seek the truth of the Shattered Crown.', timestamp: '00:47' },
        { id: 't8', speaker: 'Silas', text: 'Truth is a heavy burden. Are you ready to carry it?', timestamp: '00:50' }
      ]
    }
  ]
};
