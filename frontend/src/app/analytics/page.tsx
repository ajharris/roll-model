'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { Entry } from '@/types/api';

export default function AnalyticsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    apiClient.getEntries().then(setEntries).catch(() => setEntries([]));
  }, []);

  const sessionsPerWeek = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry) => {
      const date = new Date(entry.createdAt);
      const key = `${date.getUTCFullYear()}-W${Math.ceil(date.getUTCDate() / 7)}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([week, sessions]) => ({ week, sessions }));
  }, [entries]);

  const intensityOverTime = entries
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((entry) => ({ date: entry.createdAt.slice(0, 10), intensity: entry.sessionMetrics.intensity }));

  const tagFrequency = useMemo(() => {
    const counter = new Map<string, number>();
    entries.forEach((entry) => entry.sessionMetrics.tags.forEach((tag) => counter.set(tag, (counter.get(tag) || 0) + 1)));
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));
  }, [entries]);

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Analytics</h2>
        {!entries.length && <p>No entries yet. Add observations to produce charts.</p>}
        <h3>Sessions per week</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={sessionsPerWeek}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis /><Tooltip /><Bar dataKey="sessions" fill="#3f6ba8" /></BarChart>
        </ResponsiveContainer>
        <h3>Intensity over time</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={intensityOverTime}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis domain={[1, 10]} /><Tooltip /><Line type="monotone" dataKey="intensity" stroke="#1d7c6f" /></LineChart>
        </ResponsiveContainer>
        <h3>Top tags</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={tagFrequency}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="tag" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#7f5fa9" /></BarChart>
        </ResponsiveContainer>
      </section>
    </Protected>
  );
}
