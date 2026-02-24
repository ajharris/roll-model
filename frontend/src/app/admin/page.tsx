'use client';

import Link from 'next/link';

import { Protected } from '@/components/Protected';

export default function AdminPage() {
  return (
    <Protected allow={['admin']}>
      <section>
        <h2>Admin</h2>
        <p className="small">Operational tools for quick triage and environment verification.</p>

        <div className="panel">
          <h3>Diagnostics</h3>
          <p className="small">Live operational checks for auth/session state and API endpoint reachability.</p>
          <Link href="/admin/diagnostics" className="button-link">
            Open diagnostics
          </Link>
        </div>

        <div className="panel">
          <h3>Config health</h3>
          <p className="small">Frontend runtime configuration validation and API reachability probe.</p>
          <Link href="/admin/config-health" className="button-link">
            Open config health
          </Link>
        </div>
      </section>
    </Protected>
  );
}
