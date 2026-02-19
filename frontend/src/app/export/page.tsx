'use client';

import { useState } from 'react';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';

export default function ExportPage() {
  const [preview, setPreview] = useState('');

  const onExport = async () => {
    const data = await apiClient.exportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `roll-model-export-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(href);
    setPreview(json.slice(0, 1000));
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Export</h2>
        <button onClick={onExport}>Download JSON export</button>
        <details>
          <summary>Preview</summary>
          <pre>{preview}</pre>
        </details>
      </section>
    </Protected>
  );
}
