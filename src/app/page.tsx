import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Story } from '@/components/landing/story/story';
import './studio/studio.css';
import './story.css';

const sans = Geist({ subsets: ['latin'], variable: '--ps-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--ps-mono' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--ps-serif' });

export const metadata = {
  title: 'GeoStar · Find it. Design it. Protect it.',
  description: 'GeoStar finds the right place to build, designs what goes on it, and protects it once people move in.',
};

export default function Page() {
  return (
    <div className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <Story />
    </div>
  );
}
