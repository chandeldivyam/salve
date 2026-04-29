import { UI_PACKAGE } from '@opendesk/ui';
import { ZERO_SCHEMA_NAME } from '@opendesk/zero-schema';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-8">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          Phase 0 dev shell
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Salve <span className="text-slate-400">·</span> opendesk dev shell
        </h1>
        <p className="mt-3 text-slate-600">
          Vite + React + TanStack Router + Tailwind v4 are wired up. Hono API is at{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">
            http://localhost:3001/healthz
          </code>
          .
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">UI package</dt>
          <dd className="font-mono">{UI_PACKAGE}</dd>
          <dt className="text-slate-500">Zero schema</dt>
          <dd className="font-mono">{ZERO_SCHEMA_NAME}</dd>
        </dl>
      </section>
    </div>
  );
}
