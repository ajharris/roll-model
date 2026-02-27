import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EntryDetailPage from './page';

const { pushMock, useParamsMock, apiClientMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useParamsMock: vi.fn(),
  apiClientMock: {
    getEntry: vi.fn(),
    getEntryCheckoffEvidence: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => useParamsMock(),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ChipInput', () => ({
  ChipInput: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: apiClientMock,
}));

const baseEntry = {
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  sections: { shared: 'shared text', private: 'private text' },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 6,
    rounds: 5,
    giOrNoGi: 'gi' as const,
    tags: ['guard'],
  },
  rawTechniqueMentions: ['triangle'],
};

describe('EntryDetailPage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    useParamsMock.mockReset();
    useParamsMock.mockReturnValue({ entryId: 'entry-1' });
    apiClientMock.getEntry.mockReset();
    apiClientMock.updateEntry.mockReset();
    apiClientMock.deleteEntry.mockReset();
    apiClientMock.getEntryCheckoffEvidence.mockReset();
    apiClientMock.getEntry.mockResolvedValue({ ...baseEntry });
    apiClientMock.getEntryCheckoffEvidence.mockResolvedValue([]);
    apiClientMock.updateEntry.mockResolvedValue({ ...baseEntry, sections: { ...baseEntry.sections } });
    apiClientMock.deleteEntry.mockResolvedValue({});
    vi.unstubAllGlobals();
  });

  it('loads entry details and updates the entry from the form', async () => {
    const user = userEvent.setup();
    apiClientMock.updateEntry.mockResolvedValue({
      ...baseEntry,
      sections: { shared: 'updated shared', private: 'private text' },
    });

    render(<EntryDetailPage />);

    const sharedTextarea = await screen.findByLabelText('Shared notes');
    await waitFor(() => expect(sharedTextarea).toHaveValue('shared text'));

    await user.clear(sharedTextarea);
    await user.type(sharedTextarea, 'updated shared');
    await user.click(screen.getByRole('button', { name: 'Update entry' }));

    await waitFor(() =>
      expect(apiClientMock.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({
          sections: { shared: 'updated shared', private: 'private text' },
        }),
      ),
    );

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('does not delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(<EntryDetailPage />);

    await screen.findByRole('button', { name: 'Delete entry' });
    await user.click(screen.getByRole('button', { name: 'Delete entry' }));

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(apiClientMock.deleteEntry).not.toHaveBeenCalled();
    expect(screen.getByText('Delete cancelled.')).toBeInTheDocument();
  });

  it('deletes entry and navigates back after confirmation', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<EntryDetailPage />);

    await screen.findByRole('button', { name: 'Delete entry' });
    await user.click(screen.getByRole('button', { name: 'Delete entry' }));

    await waitFor(() => expect(apiClientMock.deleteEntry).toHaveBeenCalledWith('entry-1'));
    expect(pushMock).toHaveBeenCalledWith('/entries');
  });
});
