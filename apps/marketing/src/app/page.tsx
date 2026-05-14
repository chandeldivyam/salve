import { AgentLogos } from '@/components/agent-logos';
import { AgentWedge } from '@/components/agent-wedge';
import { ClosingCTA } from '@/components/closing-cta';
import { FeatureAPI } from '@/components/feature-api';
import { FeatureKeyboard } from '@/components/feature-keyboard';
import { FeatureOSS } from '@/components/feature-oss';
import { Footer } from '@/components/footer';
import { Hero } from '@/components/hero';
import { Nav } from '@/components/nav';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="relative">
        <Hero />
        <AgentLogos />
        <AgentWedge />
        <FeatureKeyboard />
        <FeatureAPI />
        <FeatureOSS />
        <ClosingCTA />
        <Footer />
      </main>
    </>
  );
}
