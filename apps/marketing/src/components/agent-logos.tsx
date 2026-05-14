import Image from 'next/image';
import { EyebrowMarker, SectionSpotlight } from './ornaments';

export function AgentLogos() {
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-24 md:py-28">
      <SectionSpotlight position="50% 50%" tint="oklch(0.78 0.1 270 / 0.12)" size="1100px 480px" />

      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <EyebrowMarker>Agent-agnostic</EyebrowMarker>

        <div className="mx-auto mt-6 max-w-[720px] text-center">
          <h2 className="text-balance text-[30px] font-semibold leading-[1.06] tracking-[-0.022em] text-fg-primary sm:text-[38px] md:text-[44px]">
            Bring your own agent.
          </h2>
          <p className="mt-3 text-pretty text-base text-fg-tertiary sm:text-[17px]">
            Plug in the AI agents your team already uses — or roll your own via the API.
          </p>
        </div>

        <ul className="mx-auto mt-10 grid max-w-[1080px] grid-cols-2 gap-3 sm:mt-14 sm:grid-cols-3 md:gap-4 lg:grid-cols-6">
          <AgentChip
            name="Claude"
            tint="oklch(0.72 0.13 60 / 0.32)"
            logo={<Image src="/logos/claude.png" alt="Claude logo" width={22} height={22} />}
          />
          <AgentChip
            name="ChatGPT"
            tint="oklch(0.7 0.16 160 / 0.28)"
            logo={<Image src="/logos/openai.png" alt="ChatGPT logo" width={22} height={22} />}
          />
          <AgentChip
            name="Codex"
            tint="oklch(0.5 0 0 / 0.28)"
            logo={
              <Image
                src="/logos/openai.png"
                alt="Codex logo"
                width={22}
                height={22}
                className="grayscale"
              />
            }
          />
          <AgentChip name="Cursor" tint="oklch(0.35 0 0 / 0.3)" logo={<CursorLogo />} />
          <AgentChip
            name="Gemini"
            tint="oklch(0.65 0.16 250 / 0.32)"
            logo={<Image src="/logos/gemini.svg" alt="Gemini logo" width={22} height={22} />}
          />
          <BringYourOwnChip />
        </ul>
      </div>
    </section>
  );
}

function CursorLogo() {
  return (
    <svg viewBox="0 0 545 545" width="22" height="22" fill="currentColor" aria-hidden="true">
      <title>Cursor</title>
      <path d="m466.383 137.073-206.469-119.2034c-6.63-3.8287-14.811-3.8287-21.441 0l-206.4586 119.2034c-5.5734 3.218-9.0144 9.169-9.0144 15.615v240.375c0 6.436 3.441 12.397 9.0144 15.615l206.4686 119.203c6.63 3.829 14.811 3.829 21.441 0l206.468-119.203c5.574-3.218 9.015-9.17 9.015-15.615v-240.375c0-6.436-3.441-12.397-9.015-15.615zm-12.969 25.25-199.316 345.223c-1.347 2.326-4.904 1.376-4.904-1.319v-226.048c0-4.517-2.414-8.695-6.33-10.963l-195.7577-113.019c-2.3263-1.347-1.3764-4.905 1.3182-4.905h398.6305c5.661 0 9.199 6.136 6.368 11.041h-.009z" />
    </svg>
  );
}

function AgentChip({ name, tint, logo }: { name: string; tint: string; logo: React.ReactNode }) {
  return (
    <li className="group relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-xl opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at center, ${tint}, transparent 70%)` }}
      />
      <div
        className="relative flex h-[68px] items-center justify-center gap-2.5 rounded-xl px-3 backdrop-blur-[2px] transition-all duration-200 group-hover:-translate-y-px"
        style={{
          border: '1px solid oklch(0.86 0.04 270 / 0.4)',
          background: 'oklch(1 0 0 / 0.65)',
          boxShadow:
            '0 0 0 0.5px oklch(1 0 0 / 0.9) inset, 0 4px 12px -8px oklch(0.4 0.04 270 / 0.18)',
        }}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-fg-secondary">
          {logo}
        </span>
        <span className="text-[13.5px] font-semibold tracking-tight text-fg-secondary transition-colors duration-200 group-hover:text-fg-primary">
          {name}
        </span>
      </div>
    </li>
  );
}

function BringYourOwnChip() {
  return (
    <li className="group relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-xl opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(ellipse at center, oklch(0.78 0.13 270 / 0.4), transparent 70%)',
        }}
      />
      <div
        className="relative flex h-[68px] items-center justify-center gap-2.5 rounded-xl px-3 backdrop-blur-[2px] transition-all duration-200 group-hover:-translate-y-px"
        style={{
          border: '1px dashed oklch(0.78 0.1 270 / 0.6)',
          background: 'oklch(0.97 0.014 270 / 0.55)',
          boxShadow:
            '0 0 0 0.5px oklch(1 0 0 / 0.85) inset, 0 4px 12px -8px oklch(0.54 0.115 270 / 0.18)',
        }}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-brand-600">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <title>Add your own</title>
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="text-[13.5px] font-semibold tracking-tight text-brand-soft-foreground">
          Your own
        </span>
      </div>
    </li>
  );
}
