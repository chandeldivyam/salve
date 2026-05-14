import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const SITE_URL = 'https://usesalve.com';
const TITLE = 'Salve — Support platform built for AI agents';
const DESCRIPTION =
  'Open-source help-desk where AI agents are first-class users — with identity, scoped permissions, and a full audit trail.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s — Salve',
  },
  description: DESCRIPTION,
  applicationName: 'Salve',
  keywords: [
    'AI agents',
    'support platform',
    'help desk',
    'open source',
    'customer support',
    'agent identity',
  ],
  authors: [{ name: 'Salve' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Salve',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
    images: [
      {
        url: '/hero-loop-poster.png',
        width: 1920,
        height: 1080,
        alt: 'Salve — an AI agent drafts a refund reply that a human teammate sends.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/hero-loop-poster.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#fbfbfb',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#org`,
      name: 'Salve',
      url: SITE_URL,
      logo: `${SITE_URL}/apple-icon.png`,
      sameAs: ['https://github.com/chandeldivyam/salve'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#site`,
      url: SITE_URL,
      name: 'Salve',
      description: DESCRIPTION,
      publisher: { '@id': `${SITE_URL}#org` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Salve',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: DESCRIPTION,
      url: SITE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div aria-hidden="true" className="page-grain" />
        {children}
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD payload is a typed object serialized at build time, no user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
