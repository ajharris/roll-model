'use client';

import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import {
  buildLocalJournalBackup,
  restoreLocalJournalBackup,
} from '@/lib/journalLocal';
import type { Entry } from '@/types/api';

type ExportPayload = {
  full?: {
    entries?: Entry[];
  };
  tidy?: {
    entries?: Entry[];
  };
};

const downloadJson = (filenamePrefix: string, data: unknown) => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `${filenamePrefix}-${new Date().toISOString()}.json`;
  link.click();
  URL.revokeObjectURL(href);
  return json;
};

const readJsonFile = async (file: File): Promise<unknown> => JSON.parse(await file.text()) as unknown;

const extractEntriesFromExport = (payload: unknown): Entry[] => {
  const candidate = (payload ?? {}) as ExportPayload;
  if (Array.isArray(candidate.full?.entries)) return candidate.full.entries;
  if (Array.isArray(candidate.tidy?.entries)) return candidate.tidy.entries;
  return [];
};

export default function ExportPage() {
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [localRestoreFile, setLocalRestoreFile] = useState<File | null>(null);

  const onExport = async () => {
    setStatus('Preparing export...');
    try {
      const data = await apiClient.exportData();
      const json = downloadJson('roll-model-export', data);
      setPreview(json.slice(0, 2000));
      setStatus('Export downloaded.');
    } catch {
      setStatus('Export failed.');
    }
  };

  const onLocalBackup = () => {
    const backup = buildLocalJournalBackup();
    const json = downloadJson('roll-model-local-journal-backup', backup);
    setPreview(json.slice(0, 2000));
    setStatus('Local backup downloaded.');
  };

  const onRestoreEntries = async () => {
    if (!restoreFile) {
      setStatus('Choose an export file first.');
      return;
    }
    setStatus('Reading export file...');
    try {
      const json = await readJsonFile(restoreFile);
      const entries = extractEntriesFromExport(json);
      if (entries.length === 0) {
        setStatus('No entries found in export.');
        return;
      }

      let restored = 0;
      for (const entry of entries) {
        await apiClient.createEntry({
          sections: {
            shared: entry.sections.shared,
            private: entry.sections.private ?? '',
          },
          sessionMetrics: entry.sessionMetrics,
          rawTechniqueMentions: entry.rawTechniqueMentions ?? [],
          mediaAttachments: entry.mediaAttachments ?? [],
        });
        restored += 1;
      }
      setStatus(`Restored ${restored} entries from export (entries only).`);
    } catch {
      setStatus('Restore failed. Check file format and try again.');
    }
  };

  const onRestoreLocalBackup = async () => {
    if (!localRestoreFile) {
      setStatus('Choose a local backup file first.');
      return;
    }
    setStatus('Restoring local backup...');
    try {
      const json = await readJsonFile(localRestoreFile);
      const result = restoreLocalJournalBackup(json);
      setStatus(
        `Local restore complete: ${result.restoredDrafts} drafts, ${result.restoredSearches} saved searches, ${result.restoredQueue} queued writes.`,
      );
    } catch {
      setStatus('Local restore failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Export</h2>
        <p className="small">Use server export for data portability. Local backup captures drafts/saved searches/offline queue.</p>

        <div className="panel">
          <h3>Export / backup</h3>
          <div className="row">
            <button onClick={onExport}>Download JSON export</button>
            <button onClick={onLocalBackup}>Download local backup</button>
          </div>
        </div>

        <div className="panel">
          <h3>Restore from export (entries)</h3>
          <label htmlFor="restore-export-file">Export JSON file</label>
          <input
            id="restore-export-file"
            type="file"
            accept="application/json"
            onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
          />
          <div className="row">
            <button type="button" onClick={onRestoreEntries}>
              Restore entries from export
            </button>
            <span className="small">Creates new entries from the exported journal entries.</span>
          </div>
        </div>

        <div className="panel">
          <h3>Restore local backup</h3>
          <label htmlFor="restore-local-file">Local backup JSON file</label>
          <input
            id="restore-local-file"
            type="file"
            accept="application/json"
            onChange={(event) => setLocalRestoreFile(event.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={onRestoreLocalBackup}>
            Restore drafts / saved searches / queue
          </button>
        </div>

        <p>{status}</p>
        <details>
          <summary>Preview</summary>
          <pre>{preview}</pre>
        </details>
      </section>
    </Protected>
  );
}
