import { FlowtapeOverlay } from '@vvedantb/flowtape/next/client';
import type { ReactNode } from 'react';

export const metadata = { title: 'flowtape Next.js demo' };

// A Server Component. The overlay entry is marked 'use client', so it renders here directly.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 32 }}>
        {children}
        {process.env.NODE_ENV === 'development' && <FlowtapeOverlay />}
      </body>
    </html>
  );
}
