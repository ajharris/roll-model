'use client';

import { useEffect, useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { IntegrationSettings } from '@/types/api';

const DEFAULT_SOURCE_OPTIONS = {
  calendar: ['google-calendar', 'apple-calendar', 'outlook-calendar'],
  wearable: ['whoop', 'oura', 'apple-health']
};

const sourceLabel = (value: string): string =>
  value
    .split('-')
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');

export default function IntegrationsPage() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await apiClient.getIntegrationSettings();
        setSettings(loaded);
      } catch {
        setStatus('Could not load integration settings.');
      }
    })();
  }, []);

  const updateProvider = async (
    provider: 'calendar' | 'wearable',
    patch: Partial<IntegrationSettings['calendar']>
  ) => {
    if (!settings) return;
    setIsSaving(true);
    setStatus('Saving...');
    try {
      const next = await apiClient.updateIntegrationSettings({ [provider]: patch });
      setSettings(next);
      setStatus('Saved.');
    } catch {
      setStatus('Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const syncDemoSignals = async () => {
    setStatus('Syncing sample signals...');
    try {
      const now = new Date().toISOString();
      const result = await apiClient.syncIntegrationSignals({
        signals: [
          {
            provider: 'calendar',
            externalId: `calendar-${now.slice(0, 10)}`,
            occurredAt: now,
            title: 'No-Gi Fundamentals',
            tags: ['evening-class']
          },
          {
            provider: 'wearable',
            externalId: `wearable-${now.slice(0, 10)}`,
            occurredAt: now.slice(0, 10),
            trained: true,
            confidence: 0.84
          }
        ]
      });
      setStatus(
        `Sync complete. Imported: ${result.imported}, duplicates: ${result.duplicates}, failures: ${result.failures.length}.`
      );
    } catch {
      setStatus('Sync failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Integrations</h2>
        <p className="small">Calendar and wearable signals are optional. You can disconnect any time.</p>
        {!settings ? <p>Loading...</p> : null}
        {settings ? (
          <div className="grid">
            {(['calendar', 'wearable'] as const).map((provider) => (
              <div key={provider} className="panel">
                <h3>{provider === 'calendar' ? 'Calendar' : 'Wearable'}</h3>
                <p className="small">
                  Connected: {settings[provider].connected ? 'yes' : 'no'} • Enabled for inference:{' '}
                  {settings[provider].enabled ? 'yes' : 'no'}
                </p>
                <div className="row">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => updateProvider(provider, { connected: !settings[provider].connected })}
                  >
                    {settings[provider].connected ? 'Disconnect' : 'Connect'}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving || !settings[provider].connected}
                    onClick={() => updateProvider(provider, { enabled: !settings[provider].enabled })}
                  >
                    {settings[provider].enabled ? 'Disable import' : 'Enable import'}
                  </button>
                </div>
                <label htmlFor={`${provider}-source`}>Source</label>
                <select
                  id={`${provider}-source`}
                  value={settings[provider].selectedSourceId ?? ''}
                  disabled={!settings[provider].connected || isSaving}
                  onChange={(event) => {
                    const selectedSourceId = event.target.value;
                    void updateProvider(provider, {
                      selectedSourceId,
                      selectedSourceLabel: sourceLabel(selectedSourceId)
                    });
                  }}
                >
                  <option value="">Select source</option>
                  {DEFAULT_SOURCE_OPTIONS[provider].map((option) => (
                    <option key={option} value={option}>
                      {sourceLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : null}
        <div className="panel">
          <h3>Manual sync</h3>
          <p className="small">Imports a sample class + wearable trained-today signal for quick testing.</p>
          <button type="button" onClick={syncDemoSignals} disabled={!settings || isSaving}>
            Run sample sync
          </button>
        </div>
        <p>{status}</p>
      </section>
    </Protected>
  );
}
