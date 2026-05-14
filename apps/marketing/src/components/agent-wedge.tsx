import { EyebrowMarker, Frame, SectionSpotlight } from './ornaments';

export function AgentWedge() {
  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-28 md:py-36">
      <SectionSpotlight position="78% 50%" tint="oklch(0.78 0.12 270 / 0.16)" size="900px 700px" />

      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <EyebrowMarker>Agent-native</EyebrowMarker>

        <div className="mt-12 grid items-center gap-12 md:mt-16 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="md:col-span-5">
            <h2 className="text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[44px] md:text-[54px]">
              Agents are users,
              <br />
              <span className="text-fg-tertiary">not features.</span>
            </h2>

            <p className="mt-6 max-w-[440px] text-pretty text-base text-fg-tertiary sm:text-lg">
              Salve treats every AI agent like a teammate — with a real identity, scoped
              permissions, and a full audit trail. The same primitives you'd use for a human hire.
            </p>

            <ul className="mt-8 space-y-3.5">
              <BulletItem
                title="Real identity"
                detail="Name, avatar, profile page. Replies come from the agent, not a bot account."
              />
              <BulletItem
                title="Scoped permissions"
                detail="Bound to specific actions and dollar limits. Never blanket admin."
              />
              <BulletItem
                title="Full audit trail"
                detail="Every read, draft, send, and escalation logged to the ticket — forever."
              />
            </ul>
          </div>

          <div className="md:col-span-7">
            <Frame padding="sm" spotlightTint="oklch(0.78 0.1 270 / 0.2)">
              <AgentProfileCard />
            </Frame>
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
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
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

function AgentProfileCard() {
  return (
    <div className="bg-white">
      <CardHeader />
      <CardStats />
      <CardActivity />
      <CardScopes />
    </div>
  );
}

function CardHeader() {
  return (
    <div className="flex items-start gap-3 border-b border-line-quiet px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
      <AgentTile />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[17px] font-semibold tracking-tight text-fg-primary">
              Aria
            </h3>
            <span className="inline-flex h-[18px] items-center rounded-full bg-brand-soft px-1.5 text-[10px] font-medium uppercase tracking-wider text-brand-soft-foreground ring-1 ring-inset ring-brand-border">
              agent
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-tertiary">
            <span>Refunds &amp; billing</span>
            <span className="hidden sm:inline"> · joined 4 months ago</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success-border bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success-soft-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Active
        </span>
      </div>
    </div>
  );
}

function AgentTile() {
  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-600 text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.18)]">
      <span className="text-[18px] font-bold tracking-tight">A</span>
      <span
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, oklch(0.85 0.1 270 / 0.35), transparent 60%)',
        }}
      />
    </div>
  );
}

function CardStats() {
  return (
    <div className="grid grid-cols-3 divide-x divide-line-quiet border-b border-line-quiet">
      <Stat label="Resolved" value="1,284" sub="this quarter" />
      <Stat label="CSAT" value="96%" sub="last 30 days" />
      <Stat label="Avg response" value="4.2s" sub="p50" />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-fg-quaternary sm:text-[10.5px] sm:tracking-[0.08em]">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums tracking-tight text-fg-primary sm:text-[22px]">
        {value}
      </div>
      <div className="hidden text-[11px] text-fg-quaternary sm:block">{sub}</div>
    </div>
  );
}

function CardActivity() {
  return (
    <div className="border-b border-line-quiet px-4 py-4 sm:px-6 sm:py-5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary">
        Recent activity
      </div>
      <ul className="mt-3 space-y-3 sm:space-y-2.5">
        <ActivityRow
          icon="sent"
          title="Sent reply on"
          ticket="#2847"
          context="Refund issued · $48.00"
          time="2m"
        />
        <ActivityRow
          icon="draft"
          title="Drafted reply on"
          ticket="#2851"
          context="Pending human approval"
          time="6m"
        />
        <ActivityRow
          icon="escalate"
          title="Escalated"
          ticket="#2839"
          context="Out of scope → Sarah"
          time="14m"
        />
      </ul>
    </div>
  );
}

function ActivityRow({
  icon,
  title,
  ticket,
  context,
  time,
}: {
  icon: 'sent' | 'draft' | 'escalate';
  title: string;
  ticket: string;
  context: string;
  time: string;
}) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] sm:items-center sm:gap-3">
      <ActivityIcon icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
        <span className="flex items-baseline gap-1.5">
          <span className="text-fg-secondary">{title}</span>
          <span className="font-medium tabular-nums text-fg-primary">{ticket}</span>
        </span>
        <span className="hidden text-fg-quaternary sm:inline">·</span>
        <span className="truncate text-[12px] text-fg-tertiary sm:text-[13px]">{context}</span>
      </div>
      <span className="shrink-0 tabular-nums text-[12px] text-fg-quaternary">{time} ago</span>
    </li>
  );
}

function ActivityIcon({ icon }: { icon: 'sent' | 'draft' | 'escalate' }) {
  const styles = {
    sent: 'bg-success-soft text-success-soft-foreground ring-success-border',
    draft: 'bg-warning-soft text-warning-soft-foreground ring-warning-border',
    escalate: 'bg-brand-soft text-brand-soft-foreground ring-brand-border',
  } as const;
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${styles[icon]}`}
    >
      {icon === 'sent' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <title>Sent</title>
          <path
            d="M2.5 6.2l2.4 2.4 4.6-5.2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'draft' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <title>Draft</title>
          <path
            d="M2.5 9.5l1.6-.4 5-5-1.2-1.2-5 5L2.5 9.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            fill="currentColor"
            fillOpacity="0.18"
          />
        </svg>
      )}
      {icon === 'escalate' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <title>Escalated</title>
          <path
            d="M3 7.5l3-3 3 3M6 4.5v6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function CardScopes() {
  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary">
        Scopes
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ScopeChip>read:tickets</ScopeChip>
        <ScopeChip>write:replies</ScopeChip>
        <ScopeChip highlight>refund:max=$200</ScopeChip>
        <ScopeChip>escalate:human</ScopeChip>
      </div>
    </div>
  );
}

function ScopeChip({ children, highlight }: { children: string; highlight?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11.5px] ${
        highlight
          ? 'border-brand-border bg-brand-soft text-brand-soft-foreground'
          : 'border-line-default bg-bg-elevated text-fg-secondary'
      }`}
    >
      {children}
    </span>
  );
}
