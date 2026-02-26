'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import {
  entryMatchesSavedSearch,
  readSavedEntrySearches,
  writeSavedEntrySearches,
  type SavedEntrySearch,
} from '@/lib/journalLocal';
import { flushOfflineCreateQueue } from '@/lib/journalQueue';
import type { Entry } from '@/types/api';

const defaultQuickAdd = {
  shared: '',
  private: '',
  tagsInput: '',
};

export default function EntriesPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [giOrNoGiFilter, setGiOrNoGiFilter] = useState<'' | 'gi' | 'no-gi'>('');
  const [minIntensity, setMinIntensity] = useState('');
  const [maxIntensity, setMaxIntensity] = useState('');
  const [savedSearches, setSavedSearches] = useState<SavedEntrySearch[]>([]);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [quickAdd, setQuickAdd] = useState(defaultQuickAdd);
  const [quickAddStatus, setQuickAddStatus] = useState('');

  useEffect(() => {
    setSavedSearches(readSavedEntrySearches());
    setLoading(true);
    void apiClient
      .getEntries()
      .then(async (loaded) => {
        setEntries(loaded);
        const flushed = await flushOfflineCreateQueue();
        if (flushed > 0) {
          const reloaded = await apiClient.getEntries();
          setEntries(reloaded);
        }
      })
      .catch(() => setError('Could not load entries.'))
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(
    () =>
      Array.from(new Set(entries.flatMap((entry) => entry.sessionMetrics.tags ?? [])))
        .sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const search: SavedEntrySearch = {
      id: 'active',
      name: 'Active',
      query,
      tag: tagFilter,
      giOrNoGi: giOrNoGiFilter,
      minIntensity,
      maxIntensity,
    };

    return entries.filter((entry) => entryMatchesSavedSearch(entry, search));
  }, [entries, giOrNoGiFilter, maxIntensity, minIntensity, query, tagFilter]);

  const saveCurrentSearch = () => {
    const name = savedSearchName.trim();
    if (!name) return;
    const next: SavedEntrySearch = {
      id: crypto.randomUUID(),
      name,
      query,
      tag: tagFilter,
      giOrNoGi: giOrNoGiFilter,
      minIntensity,
      maxIntensity,
    };
    const updated = [next, ...savedSearches].slice(0, 20);
    setSavedSearches(updated);
    writeSavedEntrySearches(updated);
    setSavedSearchName('');
  };

  const applySavedSearch = (search: SavedEntrySearch) => {
    setQuery(search.query);
    setTagFilter(search.tag);
    setGiOrNoGiFilter(search.giOrNoGi);
    setMinIntensity(search.minIntensity);
    setMaxIntensity(search.maxIntensity);
  };

  const deleteSavedSearch = (id: string) => {
    const updated = savedSearches.filter((search) => search.id !== id);
    setSavedSearches(updated);
    writeSavedEntrySearches(updated);
  };

  const submitQuickAdd = async () => {
    if (!quickAdd.shared.trim()) {
      setQuickAddStatus('Shared notes are required.');
      return;
    }
    setQuickAddStatus('Saving...');
    try {
      await apiClient.createEntry({
        sections: { shared: quickAdd.shared.trim(), private: quickAdd.private.trim() },
        sessionMetrics: {
          durationMinutes: 30,
          intensity: 6,
          rounds: 3,
          giOrNoGi: 'no-gi',
          tags: quickAdd.tagsInput
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
        rawTechniqueMentions: [],
        mediaAttachments: [],
      });
      setQuickAdd(defaultQuickAdd);
      setQuickAddStatus('Saved.');
      setEntries(await apiClient.getEntries());
    } catch {
      setQuickAddStatus('Quick add failed. Use full form or try again.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Observations</h2>
        <p className="small">BJJ Lab Notebook: evidence over vibes.</p>
        <Link href="/entries/new" className="button-link">
          Create a new entry
        </Link>

        <div className="panel">
          <h3>Quick add (&lt;30s mobile flow)</h3>
          <label htmlFor="quick-shared">Shared notes</label>
          <textarea
            id="quick-shared"
            value={quickAdd.shared}
            onChange={(event) => setQuickAdd((current) => ({ ...current, shared: event.target.value }))}
            placeholder="1-2 rounds, one outcome, one thing to test next"
          />
          <div className="grid">
            <div>
              <label htmlFor="quick-private">Private note (optional)</label>
              <input
                id="quick-private"
                value={quickAdd.private}
                onChange={(event) => setQuickAdd((current) => ({ ...current, private: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="quick-tags">Tags (comma separated)</label>
              <input
                id="quick-tags"
                value={quickAdd.tagsInput}
                onChange={(event) => setQuickAdd((current) => ({ ...current, tagsInput: event.target.value }))}
                placeholder="guard, open-mat"
              />
            </div>
          </div>
          <div className="row">
            <button type="button" onClick={submitQuickAdd}>
              Quick save
            </button>
            <span className="small">{quickAddStatus}</span>
          </div>
        </div>

        <div className="panel">
          <h3>Search & filters</h3>
          <div className="grid">
            <div>
              <label htmlFor="search-query">Text search</label>
              <input
                id="search-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="keywords, technique, clip note"
              />
            </div>
            <div>
              <label htmlFor="search-tag">Tag</label>
              <select id="search-tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="">all</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="search-gi">Gi / no-gi</label>
              <select
                id="search-gi"
                value={giOrNoGiFilter}
                onChange={(event) => setGiOrNoGiFilter(event.target.value as '' | 'gi' | 'no-gi')}
              >
                <option value="">all</option>
                <option value="gi">gi</option>
                <option value="no-gi">no-gi</option>
              </select>
            </div>
            <div>
              <label htmlFor="search-min-intensity">Min intensity</label>
              <input
                id="search-min-intensity"
                type="number"
                min={1}
                max={10}
                value={minIntensity}
                onChange={(event) => setMinIntensity(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="search-max-intensity">Max intensity</label>
              <input
                id="search-max-intensity"
                type="number"
                min={1}
                max={10}
                value={maxIntensity}
                onChange={(event) => setMaxIntensity(event.target.value)}
              />
            </div>
          </div>
          <div className="row">
            <input
              value={savedSearchName}
              onChange={(event) => setSavedSearchName(event.target.value)}
              placeholder="Saved search name"
              aria-label="Saved search name"
            />
            <button type="button" onClick={saveCurrentSearch}>
              Save current search
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTagFilter('');
                setGiOrNoGiFilter('');
                setMinIntensity('');
                setMaxIntensity('');
              }}
            >
              Clear filters
            </button>
            <span className="small">{filteredEntries.length} results</span>
          </div>
          {savedSearches.length > 0 && (
            <div>
              <p className="small">Saved searches</p>
              <div className="chip-row">
                {savedSearches.map((search) => (
                  <span key={search.id} className="row">
                    <button type="button" className="chip" onClick={() => applySavedSearch(search)}>
                      {search.name}
                    </button>
                    <button type="button" className="chip" onClick={() => deleteSavedSearch(search.id)} aria-label={`Delete ${search.name}`}>
                      x
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {loading && <p>Loading entries...</p>}
        {error && <p>{error}</p>}
        {!loading &&
          filteredEntries.map((entry) => (
            <div key={entry.entryId} className="list-item">
              <p>
                <Link href={`/entries/${entry.entryId}`}>{new Date(entry.createdAt).toLocaleString()}</Link>
              </p>
              <p>
                Intensity: {entry.sessionMetrics.intensity}/10 • {entry.sessionMetrics.giOrNoGi} • Rounds:{' '}
                {entry.sessionMetrics.rounds}
              </p>
              <p>Tags: {entry.sessionMetrics.tags.join(', ') || 'none'}</p>
              <p>{entry.sections.shared.slice(0, 140)}</p>
              {entry.mediaAttachments && entry.mediaAttachments.length > 0 && (
                <p className="small">
                  Media: {entry.mediaAttachments.length} • Clip notes:{' '}
                  {entry.mediaAttachments.reduce((sum, attachment) => sum + attachment.clipNotes.length, 0)}
                </p>
              )}
              <p className="small">
                <Link href={`/entries/${entry.entryId}`} className="button-link">
                  View / Edit
                </Link>
              </p>
            </div>
          ))}
      </section>
    </Protected>
  );
}
