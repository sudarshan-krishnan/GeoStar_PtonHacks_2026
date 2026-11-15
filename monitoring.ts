import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'PlotStar — Find it. Design it. Protect it.',
  description:
    'From the right place to a better-built future. Site intelligence, conceptual architecture, and connected building protection.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
