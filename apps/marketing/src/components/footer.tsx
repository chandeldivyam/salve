export function Footer() {
  return (
    <footer className="relative isolate pt-12 pb-16 sm:pt-16 sm:pb-20">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <div className="section-hairline" />
        <div className="mt-10 grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <SalveMark size={22} />
              <span className="text-[15px] font-semibold tracking-tight text-fg-primary">
                Salve
              </span>
            </div>
            <p className="mt-3 max-w-[320px] text-[13.5px] text-fg-tertiary">
              An open-source, agent-native support platform. Apache-2.0 — built in the open.
            </p>
          </div>

          <FooterColumn title="Product">
            <FooterLink href="https://app.usesalve.com">Get started</FooterLink>
            <FooterLink href="https://github.com/chandeldivyam/salve#docs">Docs</FooterLink>
            <FooterLink href="https://github.com/chandeldivyam/salve/releases">
              Changelog
            </FooterLink>
          </FooterColumn>

          <FooterColumn title="Project">
            <FooterLink href="https://github.com/chandeldivyam/salve">GitHub</FooterLink>
            <FooterLink href="https://github.com/chandeldivyam/salve/issues">Issues</FooterLink>
            <FooterLink href="mailto:support@usesalve.com">Contact</FooterLink>
          </FooterColumn>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-2 text-[12px] text-fg-quaternary sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Salve. Apache-2.0.</span>
          <span>Built with care in the open.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-quaternary">
        {title}
      </div>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith('http') || href.startsWith('mailto');
  return (
    <li>
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="text-[13.5px] text-fg-secondary transition-colors hover:text-fg-primary"
      >
        {children}
      </a>
    </li>
  );
}

function SalveMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" className="text-brand-600">
      <title>Salve</title>
      <path d="M20 4c0 8-5 14-13 14h-3c0-8 5-14 13-14h3z" fill="currentColor" opacity="0.18" />
      <path
        d="M20 4c0 8-5 14-13 14h-3c0-8 5-14 13-14h3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 18c4-2 8-6 11-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
