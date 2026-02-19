'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChipInput } from '@/components/ChipInput';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';

export default function NewEntryPage() {
  const [shared, setShared] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [intensity, setIntensity] = useState(6);
  const [rounds, setRounds] = useState(5);
  const [giOrNoGi, setGiOrNoGi] = useState<'gi' | 'no-gi'>('gi');
  const [tags, setTags] = useState<string[]>([]);
  const [techniques, setTechniques] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const router = useRouter();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('Saving...');
    try {
      await apiClient.createEntry({
        sections: { shared, private: privateText },
        sessionMetrics: { durationMinutes, intensity, rounds, giOrNoGi, tags },
        rawTechniqueMentions: techniques,
      });
      setStatus('Saved.');
      router.push('/entries');
    } catch {
      setStatus('Save failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>New journal entry</h2>
        <form onSubmit={submit}>
          <label>Shared notes</label>
          <textarea value={shared} onChange={(e) => setShared(e.target.value)} required />
          <label>Private notes</label>
          <textarea value={privateText} onChange={(e) => setPrivateText(e.target.value)} required />
          <div className="grid">
            <div>
              <label>Duration (minutes)</label>
              <input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} />
            </div>
            <div>
              <label>Intensity (1-10)</label>
              <input type="number" min={1} max={10} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
            </div>
            <div>
              <label>Rounds</label>
              <input type="number" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </div>
            <div>
              <label>Gi or no-gi</label>
              <select value={giOrNoGi} onChange={(e) => setGiOrNoGi(e.target.value as 'gi' | 'no-gi')}>
                <option value="gi">gi</option>
                <option value="no-gi">no-gi</option>
              </select>
            </div>
          </div>
          <ChipInput label="Tags" values={tags} onChange={setTags} />
          <ChipInput label="Technique mentions" values={techniques} onChange={setTechniques} />
          <button type="submit">Save entry</button>
          <p>{status}</p>
        </form>
      </section>
    </Protected>
  );
}
