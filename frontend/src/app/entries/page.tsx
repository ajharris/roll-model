'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import {
  entryMatchesSavedSearch,
  readSavedEntrySearches,
  writeSavedEntrySearches,
} from '@/lib/journalLocal';
import { flushOfflineCreateQueue } from '@/lib/journalQueue';
import type { Entry, SavedEntrySearch, SavedEntrySearchUpsertPayload } from '@/types/api';

const defaultQuickAdd = {
  shared: '',
  private: '',
  tagsInput: '',
};

type SearchSortBy = SavedEntrySearch['sortBy'];
type SearchSortDirection = SavedEntrySearch['sortDirection'];

const DEFAULT_SORT_BY: SearchSortBy = 'createdAt';
const DEFAULT_SORT_DIRECTION: SearchSortDirection = 'desc';

export default function EntriesPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [giOrNoGiFilter, setGiOrNoGiFilter] = useState<'' | 'gi' | 'no-gi'>('');
  const [minIntensity, setMinIntensity] = useState('');
  const [maxIntensity, setMaxIntensity] = useState('');
  const [sortBy, setSortBy] = useState<SearchSortBy>(DEFAULT_SORT_BY);
  const [sortDirection, setSortDirection] = useState<SearchSortDirection>(DEFAULT_SORT_DIRECTION);
  const [savedSearches, setSavedSearches] = useState<SavedEntrySearch[]>([]);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [editingSavedSearchId, setEditingSavedSearchId] = useState<string | null>(null);
  const [editingSavedSearchName, setEditingSavedSearchName] = useState('');
  const [savedSearchStatus, setSavedSearchStatus] = useState('');
  const [quickAdd, setQuickAdd] = useState(defaultQuickAdd);
  const [quickAddStatus, setQuickAddStatus] = useState('');

  useEffect(() => {
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

  useEffect(() => {
    let cancelled = false;
    const localSavedSearches = readSavedEntrySearches();
    setSavedSearches(localSavedSearches);

    const syncSavedSearches = async () => {
      try {
        const remote = await apiClient.listSavedSearches();
        if (cancelled) return;

        if (remote.length === 0 && localSavedSearches.length > 0) {
          const migrated: SavedEntrySearch[] = [];
          for (const localSearch of localSavedSearches) {
            const created = await apiClient.createSavedSearch(savedSearchToPayload(localSearch));
            migrated.push(created);
          }
          if (cancelled) return;
          persistSavedSearches(migrated);
          setSavedSearchStatus(`Migrated ${migrated.length} saved searches to your account.`);
          return;
        }

        persistSavedSearches(remote);
        if (localSavedSearches.length > 0) {
          setSavedSearchStatus('');
        }
      } catch {
        if (!cancelled && localSavedSearches.length > 0) {
          setSavedSearchStatus('Saved search dashboards loaded from local cache.');
        }
      }
    };

    void syncSavedSearches();

    return () => {
      cancelled = true;
    };
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
      sortBy,
      sortDirection,
    };

    const filtered = entries.filter((entry) => entryMatchesSavedSearch(entry, search));
    filtered.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (sortBy === 'intensity') {
        return (a.sessionMetrics.intensity - b.sessionMetrics.intensity) * direction;
      }

      return a.createdAt.localeCompare(b.createdAt) * direction;
    });

    return filtered;
  }, [entries, giOrNoGiFilter, maxIntensity, minIntensity, query, sortBy, sortDirection, tagFilter]);

  const persistSavedSearches = (next: SavedEntrySearch[]) => {
    setSavedSearches(next);
    writeSavedEntrySearches(next);
  };

  const buildCurrentSearchPayload = (
    overrides?: Partial<SavedEntrySearchUpsertPayload>,
  ): SavedEntrySearchUpsertPayload => ({
    name: overrides?.name ?? savedSearchName.trim(),
    query,
    tag: tagFilter,
    giOrNoGi: giOrNoGiFilter,
    minIntensity,
    maxIntensity,
    sortBy,
    sortDirection,
    ...(overrides?.isPinned !== undefined ? { isPinned: overrides.isPinned } : {}),
    ...(overrides?.isFavorite !== undefined ? { isFavorite: overrides.isFavorite } : {}),
  });

  const buildLocalSavedSearch = (
    payload: SavedEntrySearchUpsertPayload,
    overrides?: Partial<SavedEntrySearch>,
  ): SavedEntrySearch => ({
    id: overrides?.id ?? crypto.randomUUID(),
    name: payload.name,
    query: payload.query,
    tag: payload.tag,
    giOrNoGi: payload.giOrNoGi,
    minIntensity: payload.minIntensity,
    maxIntensity: payload.maxIntensity,
    sortBy: payload.sortBy,
    sortDirection: payload.sortDirection,
    ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
    ...(payload.isFavorite !== undefined ? { isFavorite: payload.isFavorite } : {}),
    ...(overrides?.userId ? { userId: overrides.userId } : {}),
    ...(overrides?.createdAt ? { createdAt: overrides.createdAt } : {}),
    ...(overrides?.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  });

  function savedSearchToPayload(search: SavedEntrySearch): SavedEntrySearchUpsertPayload {
    return {
      name: search.name,
      query: search.query,
      tag: search.tag,
      giOrNoGi: search.giOrNoGi,
      minIntensity: search.minIntensity,
      maxIntensity: search.maxIntensity,
      sortBy: search.sortBy,
      sortDirection: search.sortDirection,
      ...(search.isPinned !== undefined ? { isPinned: search.isPinned } : {}),
      ...(search.isFavorite !== undefined ? { isFavorite: search.isFavorite } : {}),
    };
  }

  const saveCurrentSearch = async () => {
    const name = savedSearchName.trim();
    if (!name) return;
    const payload = buildCurrentSearchPayload({ name });

    try {
      const created = await apiClient.createSavedSearch(payload);
      const updated = [created, ...savedSearches.filter((search) => search.id !== created.id)].slice(0, 20);
      persistSavedSearches(updated);
      setActiveSavedSearchId(created.id);
      setSavedSearchStatus('Saved dashboard.');
      setSavedSearchName('');
    } catch {
      const next = buildLocalSavedSearch(payload);
      const updated = [next, ...savedSearches].slice(0, 20);
      persistSavedSearches(updated);
      setActiveSavedSearchId(next.id);
      setSavedSearchStatus('Saved locally. Sync will resume when the API is reachable.');
      setSavedSearchName('');
    }
  };

  const applySavedSearch = (search: SavedEntrySearch) => {
    setActiveSavedSearchId(search.id);
    setQuery(search.query);
    setTagFilter(search.tag);
    setGiOrNoGiFilter(search.giOrNoGi);
    setMinIntensity(search.minIntensity);
    setMaxIntensity(search.maxIntensity);
    setSortBy(search.sortBy);
    setSortDirection(search.sortDirection);
  };

  const deleteSavedSearch = async (id: string) => {
    try {
      await apiClient.deleteSavedSearch(id);
      setSavedSearchStatus('Deleted dashboard.');
    } catch {
      setSavedSearchStatus('Deleted local copy. API delete failed.');
    }
    const updated = savedSearches.filter((search) => search.id !== id);
    persistSavedSearches(updated);
    if (activeSavedSearchId === id) {
      setActiveSavedSearchId(null);
    }
    if (editingSavedSearchId === id) {
      setEditingSavedSearchId(null);
      setEditingSavedSearchName('');
    }
  };

  const updateActiveSavedSearch = async () => {
    if (!activeSavedSearchId) return;
    const existing = savedSearches.find((search) => search.id === activeSavedSearchId);
    if (!existing) return;

    const payload = buildCurrentSearchPayload({
      name: existing.name,
      isPinned: existing.isPinned,
      isFavorite: existing.isFavorite,
    });

    try {
      const remote = await apiClient.updateSavedSearch(existing.id, payload);
      const updated = savedSearches.map((search) => (search.id === existing.id ? remote : search));
      persistSavedSearches(updated);
      setSavedSearchStatus('Updated dashboard.');
    } catch {
      const local = buildLocalSavedSearch(payload, {
        id: existing.id,
        userId: existing.userId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      const updated = savedSearches.map((search) => (search.id === existing.id ? local : search));
      persistSavedSearches(updated);
      setSavedSearchStatus('Updated local dashboard. API update failed.');
    }
  };

  const startRenameSavedSearch = (search: SavedEntrySearch) => {
    setEditingSavedSearchId(search.id);
    setEditingSavedSearchName(search.name);
  };

  const commitRenameSavedSearch = async () => {
    if (!editingSavedSearchId) return;
    const name = editingSavedSearchName.trim();
    if (!name) return;
    const target = savedSearches.find((search) => search.id === editingSavedSearchId);
    if (!target) return;

    const payload = savedSearchToPayload({ ...target, name });

    try {
      const remote = await apiClient.updateSavedSearch(editingSavedSearchId, payload);
      const updated = savedSearches.map((search) => (search.id === editingSavedSearchId ? remote : search));
      persistSavedSearches(updated);
      setSavedSearchStatus('Renamed dashboard.');
    } catch {
      const updated = savedSearches.map((search) =>
        search.id === editingSavedSearchId
          ? { ...search, name, updatedAt: new Date().toISOString() }
          : search,
      );
      persistSavedSearches(updated);
      setSavedSearchStatus('Renamed local dashboard. API rename failed.');
    }
    setEditingSavedSearchId(null);
    setEditingSavedSearchName('');
  };

  const clearSearchFilters = () => {
    setActiveSavedSearchId(null);
    setQuery('');
    setTagFilter('');
    setGiOrNoGiFilter('');
    setMinIntensity('');
    setMaxIntensity('');
    setSortBy(DEFAULT_SORT_BY);
    setSortDirection(DEFAULT_SORT_DIRECTION);
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
            <div>
              <label htmlFor="search-sort-by">Sort by</label>
              <select
                id="search-sort-by"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SearchSortBy)}
              >
                <option value="createdAt">Date</option>
                <option value="intensity">Intensity</option>
              </select>
            </div>
            <div>
              <label htmlFor="search-sort-direction">Sort direction</label>
              <select
                id="search-sort-direction"
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SearchSortDirection)}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>
          <div className="row">
            <input
              value={savedSearchName}
              onChange={(event) => setSavedSearchName(event.target.value)}
              placeholder="Saved search name"
              aria-label="Saved search name"
            />
            <button type="button" onClick={() => void saveCurrentSearch()}>
              Save current search
            </button>
            <button type="button" onClick={() => void updateActiveSavedSearch()} disabled={!activeSavedSearchId}>
              Update saved search
            </button>
            <button type="button" onClick={clearSearchFilters}>
              Clear filters
            </button>
            <span className="small">{filteredEntries.length} results</span>
          </div>
          {savedSearchStatus && <p className="small">{savedSearchStatus}</p>}
          {savedSearches.length > 0 && (
            <div>
              <p className="small">Saved searches (dashboards)</p>
              <div>
                {savedSearches.map((search) => (
                  <div key={search.id} className="row" style={{ marginBottom: 8 }}>
                    {editingSavedSearchId === search.id ? (
                      <>
                        <input
                          value={editingSavedSearchName}
                          onChange={(event) => setEditingSavedSearchName(event.target.value)}
                          aria-label={`Rename ${search.name}`}
                        />
                        <button type="button" onClick={() => void commitRenameSavedSearch()}>
                          Save name
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSavedSearchId(null);
                            setEditingSavedSearchName('');
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => applySavedSearch(search)}
                          aria-pressed={activeSavedSearchId === search.id}
                        >
                          {search.name}
                        </button>
                        <span className="small">
                          {search.sortBy === 'createdAt' ? 'date' : 'intensity'} / {search.sortDirection}
                        </span>
                        <button type="button" onClick={() => applySavedSearch(search)}>
                          Run
                        </button>
                        <button type="button" onClick={() => startRenameSavedSearch(search)}>
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSavedSearch(search.id)}
                          aria-label={`Delete ${search.name}`}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
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
