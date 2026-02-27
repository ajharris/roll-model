import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EntriesPage from './page';

import type * as JournalLocalModule from '@/lib/journalLocal';

const { apiClientMock, flushOfflineMutationQueueMock, readSavedEntrySearchesMock, writeSavedEntrySearchesMock } =
  vi.hoisted(() => ({
    apiClientMock: {
      getEntries: vi.fn(),
      listSavedSearches: vi.fn(),
      createSavedSearch: vi.fn(),
      updateSavedSearch: vi.fn(),
      deleteSavedSearch: vi.fn(),
      createEntry: vi.fn(),
    },
    flushOfflineMutationQueueMock: vi.fn(),
    readSavedEntrySearchesMock: vi.fn(),
    writeSavedEntrySearchesMock: vi.fn(),
  }));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: apiClientMock,
}));

vi.mock('@/lib/journalQueue', () => ({
  flushOfflineMutationQueue: () => flushOfflineMutationQueueMock(),
}));

vi.mock('@/lib/journalLocal', async () => {
  const actual = await vi.importActual<typeof JournalLocalModule>('@/lib/journalLocal');
  return {
    ...actual,
    readSavedEntrySearches: () => readSavedEntrySearchesMock(),
    writeSavedEntrySearches: (...args: unknown[]) => writeSavedEntrySearchesMock(...args),
  };
});

const sampleEntries = [
  {
    entryId: 'entry-1',
    athleteId: 'athlete-1',
    createdAt: '2026-02-20T10:00:00.000Z',
    updatedAt: '2026-02-20T10:00:00.000Z',
    schemaVersion: 2,
    sections: { shared: 'Open mat with Alex. Knee shield wins.', private: 'Partner Alex' },
    sessionMetrics: {
      durationMinutes: 60,
      intensity: 7,
      rounds: 5,
      giOrNoGi: 'no-gi' as const,
      tags: ['open-mat', 'guard'],
    },
    rawTechniqueMentions: ['knee shield'],
    mediaAttachments: [],
  },
];

describe('EntriesPage search UI', () => {
  beforeEach(() => {
    apiClientMock.getEntries.mockReset();
    apiClientMock.listSavedSearches.mockReset();
    apiClientMock.createSavedSearch.mockReset();
    apiClientMock.updateSavedSearch.mockReset();
    apiClientMock.deleteSavedSearch.mockReset();
    apiClientMock.createEntry.mockReset();
    flushOfflineMutationQueueMock.mockReset();
    readSavedEntrySearchesMock.mockReset();
    writeSavedEntrySearchesMock.mockReset();

    apiClientMock.getEntries.mockResolvedValue(sampleEntries);
    apiClientMock.listSavedSearches.mockResolvedValue([]);
    flushOfflineMutationQueueMock.mockResolvedValue({
      processed: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      remainingPending: 0,
      remainingFailed: 0,
    });
    readSavedEntrySearchesMock.mockReturnValue([]);
  });

  it('sends combined text and journaling filters to the entries API request model', async () => {
    const user = userEvent.setup();
    render(<EntriesPage />);

    await screen.findByText('Observations');
    await waitFor(() => expect(apiClientMock.getEntries).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Text search'), { target: { value: 'knee shield guard' } });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'half guard' } });
    fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Technique'), { target: { value: 'knee shield' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'win' } });
    fireEvent.change(screen.getByLabelText('Class type'), { target: { value: 'open mat' } });
    fireEvent.change(screen.getByLabelText('Date from'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('Date to'), { target: { value: '2026-02-28' } });
    await user.selectOptions(screen.getByLabelText('Gi / no-gi'), 'no-gi');
    await user.selectOptions(screen.getByLabelText('Tag'), 'open-mat');
    fireEvent.change(screen.getByLabelText('Min intensity'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Max intensity'), { target: { value: '8' } });
    await user.click(screen.getByRole('button', { name: 'Run API search' }));

    await waitFor(() =>
      expect(apiClientMock.getEntries).toHaveBeenLastCalledWith({
        query: 'knee shield guard',
        dateFrom: '2026-02-01',
        dateTo: '2026-02-28',
        position: 'half guard',
        partner: 'Alex',
        technique: 'knee shield',
        outcome: 'win',
        classType: 'open mat',
        tag: 'open-mat',
        giOrNoGi: 'no-gi',
        minIntensity: '6',
        maxIntensity: '8',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
    );
  });
});
