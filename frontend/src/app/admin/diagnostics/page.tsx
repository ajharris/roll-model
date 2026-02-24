'use client';

import { useEffect, useState } from 'react';

import { Protected } from '@/components/Protected';
import { useAuth } from '@/contexts/AuthContext';
import { getFrontendRuntimeConfig } from '@/lib/runtimeConfig';

type CheckLevel = 'ok' | 'warn' | 'error' | 'pending';

interface CheckResult {
  key: string;
  label: string;
  level: CheckLevel;
  summary: string;
  detail: string;
}

const isValidHttpUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const levelLabel = (level: CheckLevel) => level.toUpperCase();

const classifyResponse = (response: Response): CheckLevel => {
  if (response.ok) return 'ok';
  if (response.status === 401 || response.status === 403) return 'warn';
  return 'error';
};

const describeResponse = (response: Response): string => {
  if (response.ok) return 'Endpoint reachable and request authorized.';
  if (response.status === 401 || response.status === 403) {
    return 'Endpoint reachable; auth or role denied (expected for some admin probes).';
  }
  return 'Endpoint responded with an error.';
};

export default function AdminDiagnosticsPage() {
  const { isAuthenticated, role, roles, tokens, user } = useAuth();
  const runtimeConfig = getFrontendRuntimeConfig();
  const [probeChecks, setProbeChecks] = useState<CheckResult[]>([
    {
      key: 'entries-probe',
      label: 'GET /entries',
      level: 'pending',
      summary: 'Waiting to run',
      detail: 'Not started.',
    },
    {
      key: 'export-probe',
      label: 'GET /export?mode=tidy',
      level: 'pending',
      summary: 'Waiting to run',
      detail: 'Not started.',
    },
  ]);
  const [runNonce, setRunNonce] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const preflightChecks: CheckResult[] = [
    {
      key: 'browser-online',
      label: 'Browser reports online',
      level:
        typeof navigator === 'undefined'
          ? 'warn'
          : navigator.onLine
            ? 'ok'
            : 'warn',
      summary:
        typeof navigator === 'undefined'
          ? 'Navigator unavailable'
          : navigator.onLine
            ? 'Browser is online'
            : 'Browser reports offline',
      detail:
        typeof navigator === 'undefined'
          ? 'This check only runs in a browser.'
          : `navigator.onLine = ${String(navigator.onLine)}`,
    },
    {
      key: 'auth-session',
      label: 'Authenticated admin session',
      level: isAuthenticated && role === 'admin' ? 'ok' : isAuthenticated ? 'warn' : 'error',
      summary: isAuthenticated ? `Signed in as ${role}` : 'Not authenticated',
      detail: `User: ${user?.email ?? user?.sub ?? 'unknown'} | roles: ${
        roles?.length ? roles.join(', ') : role
      }`,
    },
    {
      key: 'id-token',
      label: 'ID token present',
      level: tokens?.idToken ? 'ok' : 'warn',
      summary: tokens?.idToken ? 'Token available for API probes' : 'API probes will run without auth token',
      detail: tokens?.idToken ? 'Authorization header will be sent.' : 'Authorization header not sent.',
    },
    {
      key: 'api-base-url',
      label: 'API base URL valid',
      level: isValidHttpUrl(runtimeConfig.apiBaseUrl) ? 'ok' : 'error',
      summary: isValidHttpUrl(runtimeConfig.apiBaseUrl) ? 'Configured' : 'Invalid API base URL',
      detail: runtimeConfig.apiBaseUrl || 'Missing NEXT_PUBLIC_API_BASE_URL',
    },
  ];

  useEffect(() => {
    const apiBaseUrl = runtimeConfig.apiBaseUrl;
    if (!isValidHttpUrl(apiBaseUrl)) {
      setProbeChecks((current) =>
        current.map((check) => ({
          ...check,
          level: 'error',
          summary: 'Probe skipped',
          detail: 'NEXT_PUBLIC_API_BASE_URL is missing or invalid.',
        })),
      );
      setLastRunAt(new Date().toISOString());
      return;
    }

    const controller = new AbortController();
    const headers = new Headers();
    if (tokens?.idToken) {
      headers.set('Authorization', `Bearer ${tokens.idToken}`);
    }

    const startProbe = (key: string, label: string, url: string): CheckResult => ({
      key,
      label,
      level: 'pending',
      summary: 'Running',
      detail: url,
    });

    const probeDefs = [
      { key: 'entries-probe', label: 'GET /entries', path: '/entries' },
      { key: 'export-probe', label: 'GET /export?mode=tidy', path: '/export?mode=tidy' },
    ];

    const pendingChecks = probeDefs.map((probe) => {
      const url = new URL(probe.path, apiBaseUrl).toString();
      return startProbe(probe.key, probe.label, url);
    });

    setProbeChecks(pendingChecks);
    setIsRunning(true);

    void Promise.all(
      probeDefs.map(async (probe) => {
        const url = new URL(probe.path, apiBaseUrl).toString();
        const startedAt = Date.now();

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers,
            cache: 'no-store',
            signal: controller.signal,
          });
          const elapsedMs = Date.now() - startedAt;
          return {
            key: probe.key,
            label: probe.label,
            level: classifyResponse(response),
            summary: `${response.status} ${response.statusText || '(no status text)'}`,
            detail: `${describeResponse(response)} ${elapsedMs}ms. ${url}`,
          } satisfies CheckResult;
        } catch (error: unknown) {
          if (controller.signal.aborted) {
            return {
              key: probe.key,
              label: probe.label,
              level: 'pending',
              summary: 'Cancelled',
              detail: url,
            } satisfies CheckResult;
          }
          return {
            key: probe.key,
            label: probe.label,
            level: 'error',
            summary: 'Network failure',
            detail: error instanceof Error ? error.message : `Request failed for ${url}`,
          } satisfies CheckResult;
        }
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setProbeChecks(results);
      setLastRunAt(new Date().toISOString());
      setIsRunning(false);
    });

    return () => {
      controller.abort();
    };
  }, [runtimeConfig.apiBaseUrl, runNonce, tokens?.idToken]);

  const allChecks = [...preflightChecks, ...probeChecks];
  const issueChecks = allChecks.filter((check) => check.level === 'warn' || check.level === 'error');
  const counts = allChecks.reduce(
    (acc, check) => {
      acc[check.level] += 1;
      return acc;
    },
    { ok: 0, warn: 0, error: 0, pending: 0 },
  );
  const overallStatus =
    counts.error > 0 ? 'degraded' : counts.warn > 0 ? 'attention needed' : counts.pending > 0 ? 'running' : 'healthy';

  const getActionHint = (check: CheckResult): string => {
    if (check.key === 'browser-online') return 'Verify local network/VPN connectivity and browser offline mode.';
    if (check.key === 'auth-session') return 'Sign in with an admin account or switch active role to admin.';
    if (check.key === 'id-token') return 'Refresh session or sign in again to restore an ID token.';
    if (check.key === 'api-base-url')
      return 'Check frontend runtime env (NEXT_PUBLIC_API_BASE_URL) and deployment config.';
    if (check.key === 'entries-probe')
      return 'If 5xx/network failure, check API Gateway/Lambda health; if 403, verify admin endpoint expectations.';
    if (check.key === 'export-probe')
      return 'If 5xx/network failure, check export Lambda/API route and downstream DynamoDB permissions.';
    return 'Use status/detail to identify the failing route and escalate to backend logs if needed.';
  };

  return (
    <Protected allow={['admin']}>
      <section>
        <h2>Admin Diagnostics</h2>
        <p className="small">
          Minimal operational checks for browser session state and live API reachability. No secrets are displayed.
        </p>

        <div className="panel">
          <h3>Run</h3>
          <div className="row">
            <button type="button" onClick={() => setRunNonce((value) => value + 1)} disabled={isRunning}>
              {isRunning ? 'Running checks...' : 'Run checks'}
            </button>
            <p className="small">
              Last run: {lastRunAt ? new Date(lastRunAt).toLocaleString() : 'Not yet completed'}
            </p>
          </div>
          <p className="small">
            Summary: {counts.ok} ok, {counts.warn} warn, {counts.error} error, {counts.pending} pending
          </p>
          <p className="small">Overall status: {overallStatus}</p>
        </div>

        <div className="panel">
          <h3>Triage summary</h3>
          {issueChecks.length ? (
            issueChecks.map((check) => (
              <div key={`triage-${check.key}`} className="list-item">
                <p>
                  {levelLabel(check.level)}: {check.label} ({check.summary})
                </p>
                <p className="small">Last issue: {check.detail}</p>
                <p className="small">Action: {getActionHint(check)}</p>
              </div>
            ))
          ) : (
            <p className="small">No current warnings or errors. Core checks are passing.</p>
          )}
        </div>

        <div className="panel">
          <h3>Operational checks</h3>
          {allChecks.map((check) => (
            <div key={check.key} className="list-item">
              <p>
                {levelLabel(check.level)}: {check.label} ({check.summary})
              </p>
              <p className="small">{check.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </Protected>
  );
}
