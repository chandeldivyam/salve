import { EyebrowMarker, Frame, SectionSpotlight } from './ornaments';

/**
 * Webhooks & API block. Copy on the left, code/payload artifact on the right.
 * The artifact shows a single ticket.created webhook payload — concrete and
 * lifted straight out of what a developer would actually see.
 */
export function FeatureAPI() {
  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-28 md:py-36">
      <SectionSpotlight position="80% 50%" tint="oklch(0.78 0.12 270 / 0.16)" size="900px 700px" />

      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <EyebrowMarker>Developer-first</EyebrowMarker>

        <div className="mt-12 grid items-start gap-12 md:mt-16 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="md:col-span-5">
            <h2 className="text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[44px] md:text-[54px]">
              An API that gets
              <br />
              <span className="text-fg-tertiary">out of the way.</span>
            </h2>

            <p className="mt-6 max-w-[440px] text-pretty text-base text-fg-tertiary sm:text-lg">
              Webhooks on every state change. REST and TypeScript SDK for everything in the product.
              No vendor-specific RPC, no XML, no SOAP nostalgia.
            </p>

            <ul className="mt-8 space-y-3.5">
              <BulletItem
                title="Signed webhooks"
                detail="HMAC-SHA256, replay-protected, with a retry curve that matches your reality."
              />
              <BulletItem
                title="Typed SDK"
                detail="Generated from the OpenAPI spec, exports types your IDE can reason about."
              />
              <BulletItem
                title="Idempotent"
                detail="Every mutation accepts an Idempotency-Key. Retry without fear."
              />
            </ul>
          </div>

          <div className="md:col-span-7">
            <CodeArtifact />
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

function CodeArtifact() {
  return (
    <Frame padding="sm" spotlightTint="oklch(0.78 0.1 270 / 0.22)">
      <div className="bg-white">
        <CodeHeader />
        <div className="grid border-t border-line-quiet md:grid-cols-2">
          <RequestPane />
          <ResponsePane />
        </div>
      </div>
    </Frame>
  );
}

function CodeHeader() {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.85_0.06_30)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.88_0.06_90)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.85_0.06_150)]" />
      </div>
      <span className="ml-2 truncate font-mono text-[11.5px] tracking-tight text-fg-tertiary">
        POST&nbsp; api.usesalve.com/v1/tickets
      </span>
      <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-soft px-2 py-0.5 text-[10.5px] font-medium text-success-soft-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        201 Created
      </span>
    </div>
  );
}

function RequestPane() {
  return (
    <div className="border-line-quiet md:border-r">
      <PaneLabel>Request</PaneLabel>
      <pre className="overflow-x-auto px-4 pb-4 font-mono text-[10.5px] leading-[1.65] sm:px-5 sm:text-[12px]">
        <Line>
          <Token kind="kw">const</Token> <Token kind="var">ticket</Token> <Token kind="op">=</Token>{' '}
          <Token kind="kw">await</Token> <Token kind="var">salve</Token>
          <Token kind="op">.</Token>
          <Token kind="fn">tickets</Token>
          <Token kind="op">.</Token>
          <Token kind="fn">create</Token>
          <Token kind="op">{'({'}</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">channel</Token>
          <Token kind="op">:</Token> <Token kind="str">'email'</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">customer</Token>
          <Token kind="op">: {'{'}</Token>
        </Line>
        <Line indent={2}>
          <Token kind="prop">email</Token>
          <Token kind="op">:</Token> <Token kind="str">'maya@northwind.co'</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={2}>
          <Token kind="prop">name</Token>
          <Token kind="op">:</Token> <Token kind="str">'Maya Chen'</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="op">{'},'}</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">subject</Token>
          <Token kind="op">:</Token> <Token kind="str">'Refund — duplicate charge'</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">assign_to</Token>
          <Token kind="op">:</Token> <Token kind="str">'agent_aria'</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line>
          <Token kind="op">{'})'}</Token>
        </Line>
      </pre>
    </div>
  );
}

function ResponsePane() {
  return (
    <div className="border-t border-line-quiet md:border-t-0">
      <PaneLabel>Webhook · ticket.created</PaneLabel>
      <pre className="overflow-x-auto px-4 pb-4 font-mono text-[10.5px] leading-[1.65] sm:px-5 sm:text-[12px]">
        <Line>
          <Token kind="op">{'{'}</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">"id"</Token>
          <Token kind="op">:</Token> <Token kind="str">"tk_01HVK8…2847"</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">"status"</Token>
          <Token kind="op">:</Token> <Token kind="str">"open"</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">"assignee"</Token>
          <Token kind="op">: {'{'}</Token>
        </Line>
        <Line indent={2}>
          <Token kind="prop">"id"</Token>
          <Token kind="op">:</Token> <Token kind="str">"agent_aria"</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={2}>
          <Token kind="prop">"kind"</Token>
          <Token kind="op">:</Token> <Token kind="str">"agent"</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="op">{'},'}</Token>
        </Line>
        <Line indent={1}>
          <Token kind="prop">"sla"</Token>
          <Token kind="op">: {'{'}</Token>
        </Line>
        <Line indent={2}>
          <Token kind="prop">"first_response_by"</Token>
          <Token kind="op">:</Token> <Token kind="str">"2026-05-14T18:11:00Z"</Token>
          <Token kind="op">,</Token>
        </Line>
        <Line indent={1}>
          <Token kind="op">{'},'}</Token>
        </Line>
        <Line>
          <Token kind="op">{'}'}</Token>
        </Line>
      </pre>
    </div>
  );
}

function PaneLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2 pt-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary sm:px-5">
      {children}
    </div>
  );
}

function Line({ children, indent = 0 }: { children: React.ReactNode; indent?: number }) {
  return (
    <div style={{ paddingLeft: `${indent * 14}px` }} className="whitespace-pre">
      {children}
    </div>
  );
}

type TokenKind = 'kw' | 'var' | 'fn' | 'prop' | 'str' | 'op';
function Token({ kind, children }: { kind: TokenKind; children: React.ReactNode }) {
  const color = {
    kw: 'text-[oklch(0.5_0.18_300)]',
    var: 'text-[oklch(0.28_0.04_270)]',
    fn: 'text-[oklch(0.5_0.14_240)]',
    prop: 'text-[oklch(0.4_0.06_270)]',
    str: 'text-[oklch(0.48_0.12_150)]',
    op: 'text-[oklch(0.5_0.012_320)]',
  }[kind];
  return <span className={color}>{children}</span>;
}
