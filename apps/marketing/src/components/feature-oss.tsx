import { EyebrowMarker, Frame, SectionSpotlight } from './ornaments';

/**
 * OSS / self-host block. Terminal artifact on the left, pitch on the right.
 * The terminal shows a 60-second self-host journey: clone → docker compose →
 * open localhost. Concrete proof that the OSS pitch isn't theatre.
 */
export function FeatureOSS() {
  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-28 md:py-36">
      <SectionSpotlight position="20% 50%" tint="oklch(0.78 0.12 270 / 0.16)" size="900px 700px" />

      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <EyebrowMarker>Open source</EyebrowMarker>

        <div className="mt-12 grid items-center gap-12 md:mt-16 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="order-2 md:order-1 md:col-span-7">
            <Terminal />
          </div>

          <div className="order-1 md:order-2 md:col-span-5">
            <h2 className="text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[44px] md:text-[54px]">
              Self-host or
              <br />
              <span className="text-fg-tertiary">stay with us.</span>
            </h2>

            <p className="mt-6 max-w-[440px] text-pretty text-base text-fg-tertiary sm:text-lg">
              Salve is Apache-2.0. Run it on your own infrastructure — your data never leaves your
              VPC. Or let us host it. Same software, same release cadence.
            </p>

            <ul className="mt-8 space-y-3.5">
              <BulletItem
                title="Docker compose"
                detail="One file, four containers, ready in under a minute on any modern Mac or Linux box."
              />
              <BulletItem
                title="Postgres + S3"
                detail="No proprietary stores. Bring your own database and object storage."
              />
              <BulletItem
                title="No telemetry"
                detail="Self-host means self-host. We don't phone home, ever."
              />
            </ul>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/chandeldivyam/salve"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-bg-canvas px-4 text-[13px] font-medium text-fg-primary transition-colors hover:bg-bg-panel"
              >
                <GitHubMark />
                Star on GitHub
              </a>
              <a
                href="https://github.com/chandeldivyam/salve#self-host"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1 px-1 text-[13px] font-medium text-fg-secondary transition-colors hover:text-fg-primary"
              >
                Read the self-host guide
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BulletItem({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-[5px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft ring-1 ring-inset ring-brand-border">
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2l2.4 2.4 4.6-5.2"
            stroke="oklch(0.46 0.1 270)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="text-[14.5px] leading-snug">
        <span className="font-semibold text-fg-primary">{title}.</span>{' '}
        <span className="text-fg-tertiary">{detail}</span>
      </div>
    </li>
  );
}

function Terminal() {
  return (
    <Frame padding="sm" spotlightTint="oklch(0.78 0.1 270 / 0.22)">
      <div
        className="relative"
        style={{
          background:
            'linear-gradient(180deg, oklch(0.18 0.018 280) 0%, oklch(0.14 0.018 280) 100%)',
        }}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.65_0.16_30)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.78_0.14_90)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.7_0.14_150)]" />
          </div>
          <span className="ml-2 truncate font-mono text-[11.5px] tracking-tight text-white/55">
            zsh — salve
          </span>
        </div>

        <pre className="overflow-x-auto px-4 pb-5 pt-3 font-mono text-[11px] leading-[1.7] sm:px-5 sm:text-[12.5px]">
          <TermLine>
            <Prompt /> git clone <Cmd>git@github.com:chandeldivyam/salve.git</Cmd>
          </TermLine>
          <TermLine subtle>
            <Faint>
              Cloning into 'salve'... <br />
              {'                  '}Receiving objects: 100% (12,481/12,481), 38.2 MiB | 22.3 MiB/s.
            </Faint>
          </TermLine>
          <TermLine>
            <Prompt /> cd salve && docker compose up -d
          </TermLine>
          <TermLine subtle>
            <Faint>
              ✔ Network salve_default {'     '} Created
              <br />✔ Container salve-postgres-1 Started
              <br />✔ Container salve-redis-1 {'   '} Started
              <br />✔ Container salve-api-1 {'     '} Started
              <br />✔ Container salve-web-1 {'     '} Started <Tag>0.4s</Tag>
            </Faint>
          </TermLine>
          <TermLine>
            <Prompt /> open <Cmd>http://localhost:3000</Cmd>
          </TermLine>
          <TermLine>
            <span className="inline-flex items-center gap-2 rounded-md border border-[oklch(0.62_0.14_150)/_0.35] bg-[oklch(0.42_0.14_150)/_0.18] px-2 py-0.5 text-[11px] font-medium text-[oklch(0.85_0.14_150)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.75_0.16_150)]" />
              Salve is running
            </span>
          </TermLine>
        </pre>
      </div>
    </Frame>
  );
}

function TermLine({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div className={`whitespace-pre-wrap ${subtle ? 'text-white/45' : 'text-white/90'}`}>
      {children}
    </div>
  );
}
function Prompt() {
  return (
    <span className="select-none">
      <span className="text-[oklch(0.8_0.13_280)]">~/salve</span>
      <span className="mx-1 text-white/35">›</span>
    </span>
  );
}
function Cmd({ children }: { children: React.ReactNode }) {
  return <span className="text-[oklch(0.85_0.1_280)]">{children}</span>;
}
function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-white/45">{children}</span>;
}
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[oklch(0.78_0.14_150)]">{children}</span>;
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <title>GitHub</title>
      <path d="M12 0C5.4 0 0 5.4 0 12c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z" />
    </svg>
  );
}
