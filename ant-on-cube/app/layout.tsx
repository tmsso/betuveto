import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ant on Cube',
  description: 'Interactive ant-on-cube direction exercise'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
