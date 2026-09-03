import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mise — Personal nutrition journal',
  description: 'Capture meals quickly, review honest nutrition estimates, and see meaningful trends.',
  applicationName: 'Mise',
  appleWebApp: { capable: true, title: 'Mise', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
