'use client';

import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { ApiError, apiClient } from '@/lib/apiClient';
import {
  buildLocalJournalBackup,
  restoreLocalJournalBackup,
} from '@/lib/journalLocal';

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

const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
};

const readJsonFile = async (file: File): Promise<unknown> => JSON.parse(await file.text()) as unknown;

export default function ExportPage() {
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [localRestoreFile, setLocalRestoreFile] = useState<File | null>(null);

  const onExportJson = async () => {
    setStatus('Preparing export...');
    setBusy(true);
    try {
      const data = await apiClient.exportData();
      const json = downloadJson('roll-model-export', data);
      setPreview(json.slice(0, 2000));
      setStatus('JSON export downloaded.');
    } catch (error) {
      setStatus(error instanceof ApiError ? `Export failed: ${error.message}` : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const onExportCsv = async () => {
    setStatus('Preparing CSV export...');
    setBusy(true);
    try {
      const csv = await apiClient.exportEntriesCsv();
      downloadTextFile(
        `roll-model-entries-${new Date().toISOString()}.csv`,
        csv,
        'text/csv;charset=utf-8',
      );
      setPreview(csv.slice(0, 2000));
      setStatus('CSV export downloaded.');
    } catch (error) {
      setStatus(error instanceof ApiError ? `CSV export failed: ${error.message}` : 'CSV export failed.');
    } finally {
      setBusy(false);
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
    setStatus('Uploading backup for restore...');
    setBusy(true);
    try {
      const json = await readJsonFile(restoreFile);
      const result = await apiClient.restoreData(json);
      setPreview(JSON.stringify(json, null, 2).slice(0, 2000));
      setStatus(
        `Restore complete: ${result.counts.entries} entries, ${result.counts.comments} comments, ${result.counts.links} links, ${result.counts.aiThreads} AI threads, ${result.counts.aiMessages} AI messages.`,
      );
    } catch (error) {
      setStatus(error instanceof ApiError ? `Restore failed: ${error.message}` : 'Restore failed. Check file format and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onRestoreLocalBackup = async () => {
    if (!localRestoreFile) {
      setStatus('Choose a local backup file first.');
      return;
    }
    setStatus('Restoring local backup...');
    setBusy(true);
    try {
      const json = await readJsonFile(localRestoreFile);
      const result = restoreLocalJournalBackup(json);
      setStatus(
        `Local restore complete: ${result.restoredDrafts} drafts, ${result.restoredSearches} saved searches, ${result.restoredQueue} queued writes.`,
      );
    } catch {
      setStatus('Local restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Export</h2>
        <p className="small">
          Use server export for data portability. Local backup captures drafts/saved
          searches/offline queue.
        </p>

        <div className="panel">
          <h3>Export / backup</h3>
          <div className="row">
            <button onClick={onExportJson} disabled={busy}>
              Download JSON export
            </button>
            <button onClick={onExportCsv} disabled={busy}>
              Download CSV entries
            </button>
            <button onClick={onLocalBackup} disabled={busy}>
              Download local backup
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Restore server backup</h3>
          <label htmlFor="restore-export-file">Export JSON file</label>
          <input
            id="restore-export-file"
            type="file"
            accept="application/json"
            onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
          />
          <div className="row">
            <button type="button" onClick={onRestoreEntries} disabled={busy}>
              Restore backup
            </button>
            <span className="small">
              Uploads a JSON backup exported from this app and restores supported data.
            </span>
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
          <button type="button" onClick={onRestoreLocalBackup} disabled={busy}>
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
