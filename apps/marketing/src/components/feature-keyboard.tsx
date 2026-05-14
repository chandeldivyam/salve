import { EyebrowMarker, Frame, SectionSpotlight } from './ornaments';

export function FeatureKeyboard() {
  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-28 md:py-36">
      <SectionSpotlight position="22% 40%" tint="oklch(0.78 0.12 270 / 0.18)" size="900px 700px" />

      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <EyebrowMarker>Keyboard-first</EyebrowMarker>

        <div className="mt-12 grid items-center gap-12 md:mt-16 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="order-2 md:order-1 md:col-span-7">
            <InboxArtifact />
          </div>

          <div className="order-1 md:order-2 md:col-span-5">
            <h2 className="text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[44px] md:text-[54px]">
              Designed to be
              <br />
              <span className="text-fg-tertiary">flown.</span>
            </h2>

            <p className="mt-6 max-w-[460px] text-pretty text-base text-fg-tertiary sm:text-lg">
              Every action is one keystroke. <InlineKey>j</InlineKey>/<InlineKey>k</InlineKey> to
              move, <InlineKey>Enter</InlineKey> to peek, <InlineKey>e</InlineKey> to resolve.
            </p>

            <dl className="mt-8 grid max-w-[400px] grid-cols-3 gap-x-4 gap-y-2">
              <Stat label="Bindings" value="30+" />
              <Stat label="Palette" value="⌘K" />
              <Stat label="Remap" value="any key" />
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary">
        {label}
      </dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums tracking-tight text-fg-primary">
        {value}
      </dd>
    </div>
  );
}

function InlineKey({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-line-default border-b-[2px] bg-bg-panel px-1.5 align-[1px] font-mono text-[12px] font-semibold text-fg-primary shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}

function InboxArtifact() {
  return (
    <div className="relative">
      <Frame padding="sm" spotlightTint="oklch(0.78 0.1 270 / 0.22)">
        <InboxBody />
      </Frame>

      <KeycapRow />

      <FloatingHint />
    </div>
  );
}

function FloatingHint() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-2 top-[152px] hidden items-center gap-2 rounded-lg border border-brand-border bg-bg-popover px-2.5 py-1.5 shadow-medium md:flex lg:-right-8"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line-default border-b-[2px] bg-bg-canvas font-mono text-[11px] font-semibold text-fg-primary">
        j
      </span>
      <span className="text-[11px] font-medium text-fg-secondary">to navigate</span>
      <svg viewBox="0 0 16 16" width="12" height="12" className="text-brand-600" aria-hidden="true">
        <title>arrow</title>
        <path
          d="M8 3v10M4.5 9.5L8 13l3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

function InboxBody() {
  return (
    <div className="bg-white">
      <InboxHeader />
      <InboxRows />
    </div>
  );
}

function InboxHeader() {
  return (
    <div className="flex items-center justify-between border-b border-line-quiet px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <h3 className="text-[14px] font-semibold tracking-tight text-fg-primary">Inbox</h3>
        <span className="truncate text-[12px] text-fg-tertiary">
          <span className="tabular-nums text-fg-secondary">12</span> unassigned ·{' '}
          <span className="tabular-nums text-fg-secondary">84</span> open
        </span>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-line-default bg-bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-fg-tertiary">
          ⌘K
        </span>
      </div>
    </div>
  );
}

function InboxRows() {
  return (
    <ul className="divide-y divide-line-quiet">
      <InboxRow
        title="Refund — duplicate charge"
        customer="Maya Chen"
        assignee="A"
        agentReply
        time="2m"
      />
      <InboxRow
        title="Question about plan limits"
        customer="Marcel Onovo"
        assignee="MO"
        time="4m"
      />
      <InboxRow
        title="Account deletion request"
        customer="Magnus Ose"
        assignee="A"
        agentReply
        time="8m"
        selected
      />
      <InboxRow
        title="Webhook stopped firing on order.created"
        customer="Adam Tala"
        assignee="ST"
        time="12m"
      />
      <InboxRow
        title="Re: API rate limits in v2"
        customer="Sachin Rao"
        assignee="A"
        agentReply
        time="18m"
      />
    </ul>
  );
}

function InboxRow({
  title,
  customer,
  assignee,
  agentReply,
  time,
  selected,
}: {
  title: string;
  customer: string;
  assignee: string;
  agentReply?: boolean;
  time: string;
  selected?: boolean;
}) {
  return (
    <li
      className={`relative flex items-center gap-2.5 px-4 py-[9px] text-[13px] sm:gap-3 sm:px-5 ${
        selected ? 'bg-brand-soft/60' : ''
      }`}
    >
      {selected && (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-brand-600" />
      )}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-brand-600' : 'bg-success'}`}
      />
      <span className="truncate font-medium text-fg-primary">{title}</span>
      <span className="hidden shrink-0 text-fg-quaternary sm:inline">·</span>
      <span className="hidden truncate text-fg-tertiary sm:inline">{customer}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2.5">
        <span className="hidden sm:flex">
          <AssigneeBadge initials={assignee} agent={agentReply} />
        </span>
        <span className="w-7 shrink-0 text-right tabular-nums text-[12px] text-fg-quaternary">
          {time}
        </span>
      </span>
    </li>
  );
}

function AssigneeBadge({ initials, agent }: { initials: string; agent?: boolean }) {
  if (agent) {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-brand-600 text-[10px] font-bold text-white">
        {initials}
      </span>
    );
  }
  return (
    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-bg-elevated text-[9.5px] font-semibold text-fg-secondary ring-1 ring-inset ring-line-default">
      {initials}
    </span>
  );
}

function KeycapRow() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2.5 pl-1">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary">
        Shortcuts
      </span>
      <Keycap label="j" hint="next" />
      <Keycap label="k" hint="prev" />
      <Keycap label="Enter" hint="peek" width="wide" />
      <Keycap label="e" hint="resolve" highlight />
    </div>
  );
}

function Keycap({
  label,
  hint,
  highlight,
  width,
}: {
  label: string;
  hint: string;
  highlight?: boolean;
  width?: 'wide';
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-7 items-center justify-center rounded-md border bg-bg-popover px-2 font-mono text-[12px] font-semibold ${
          width === 'wide' ? 'min-w-12' : 'min-w-7'
        } ${
          highlight
            ? 'border-brand-border bg-brand-soft text-brand-soft-foreground'
            : 'border-line-default border-b-[2px] text-fg-primary'
        }`}
      >
        {label}
      </span>
      <span className="text-[11px] text-fg-tertiary">{hint}</span>
    </div>
  );
}
