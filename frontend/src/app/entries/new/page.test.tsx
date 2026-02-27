import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewEntryPage from './page';

const pushMock = vi.fn();

const {
  apiClientMock,
  flushOfflineCreateQueueMock,
  readEntryDraftMock,
  writeEntryDraftMock,
  clearEntryDraftMock,
  enqueueOfflineCreateMock,
} = vi.hoisted(() => ({
  apiClientMock: {
    createEntry: vi.fn(),
    chat: vi.fn(),
    updateEntry: vi.fn(),
    upsertEntryCheckoffEvidence: vi.fn(),
  },
  flushOfflineCreateQueueMock: vi.fn(),
  readEntryDraftMock: vi.fn(),
  writeEntryDraftMock: vi.fn(),
  clearEntryDraftMock: vi.fn(),
  enqueueOfflineCreateMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: apiClientMock,
}));

vi.mock('@/lib/journalQueue', () => ({
  flushOfflineCreateQueue: () => flushOfflineCreateQueueMock(),
}));

vi.mock('@/lib/journalLocal', () => ({
  applyEntryTemplate: (templateId: 'class-notes' | 'open-mat-rounds' | 'drill-session') => {
    if (templateId === 'drill-session') {
      return {
        sections: { shared: 'Drill session: reps completed, constraints, and transfer to live rounds.', private: '' },
        sessionMetrics: { durationMinutes: 50, intensity: 4, rounds: 0, giOrNoGi: 'gi', tags: ['drilling'] },
        rawTechniqueMentions: [],
        templateId,
      };
    }
    if (templateId === 'open-mat-rounds') {
      return {
        sections: { shared: 'Open mat rounds: experiments, outcomes, and decision points.', private: '' },
        sessionMetrics: { durationMinutes: 75, intensity: 7, rounds: 7, giOrNoGi: 'no-gi', tags: ['open-mat'] },
        rawTechniqueMentions: [],
        templateId,
      };
    }
    return {
      sections: { shared: 'Class notes: key wins, leaks, and one focus for next session.', private: '' },
      sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 4, giOrNoGi: 'gi', tags: ['class-notes'] },
      rawTechniqueMentions: [],
      templateId,
    };
  },
  clearEntryDraft: (...args: unknown[]) => clearEntryDraftMock(...args),
  enqueueOfflineCreate: (...args: unknown[]) => enqueueOfflineCreateMock(...args),
  readEntryDraft: () => readEntryDraftMock(),
  writeEntryDraft: (...args: unknown[]) => writeEntryDraftMock(...args),
}));

describe('NewEntryPage phase 1 flow', () => {
  beforeEach(() => {
    pushMock.mockReset();
    apiClientMock.createEntry.mockReset();
    apiClientMock.chat.mockReset();
    apiClientMock.updateEntry.mockReset();
    apiClientMock.upsertEntryCheckoffEvidence.mockReset();
    flushOfflineCreateQueueMock.mockReset();
    readEntryDraftMock.mockReset();
    writeEntryDraftMock.mockReset();
    clearEntryDraftMock.mockReset();
    enqueueOfflineCreateMock.mockReset();

    readEntryDraftMock.mockReturnValue(null);
    flushOfflineCreateQueueMock.mockResolvedValue(0);
    apiClientMock.createEntry.mockResolvedValue({
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2026-02-26T00:00:00.000Z',
      updatedAt: '2026-02-26T00:00:00.000Z',
      sections: { shared: 's', private: 'p' },
      sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 4, giOrNoGi: 'gi', tags: ['class-notes'] },
      rawTechniqueMentions: [],
      mediaAttachments: [],
      templateId: 'class-notes',
    });
    apiClientMock.chat.mockResolvedValue({
      assistant_text: 'Done',
      extracted_updates: {
        summary: 'Summary',
        actionPack: {
          wins: ['Top pressure'],
          leaks: ['Late underhook'],
          oneFocus: 'Pummel first',
          drills: ['Underhook pummel x20'],
          positionalRequests: ['Start in half guard bottom'],
          fallbackDecisionGuidance: 'Recover knee shield if flattened.',
          confidenceFlags: [{ field: 'leaks', confidence: 'low', note: 'Could be timing.' }],
        },
        suggestedFollowUpQuestions: ['What was your first grip?'],
      },
    });
    apiClientMock.updateEntry.mockResolvedValue({});
    apiClientMock.upsertEntryCheckoffEvidence.mockResolvedValue({
      checkoffs: [],
      evidence: [],
      pendingConfirmationCount: 0,
    });
  });

  it('applies drill-session template defaults', async () => {
    const user = userEvent.setup();
    render(<NewEntryPage />);

    await user.click(screen.getByRole('button', { name: 'Drill session' }));

    expect(screen.getByLabelText('Shared notes')).toHaveValue(
      'Drill session: reps completed, constraints, and transfer to live rounds.',
    );
    expect(screen.getByLabelText('Rounds')).toHaveValue(0);
  });

  it('runs save + GPT + finalize with confidence corrections', async () => {
    const user = userEvent.setup();
    render(<NewEntryPage />);

    fireEvent.change(screen.getByLabelText('Shared notes'), { target: { value: 'Fast class notes' } });
    fireEvent.change(screen.getByLabelText('Private notes'), { target: { value: 'I lost underhook twice.' } });

    await user.click(screen.getByRole('button', { name: 'Save + run GPT' }));

    await waitFor(() => {
      expect(apiClientMock.createEntry).toHaveBeenCalledTimes(1);
      expect(apiClientMock.chat).toHaveBeenCalledTimes(1);
      expect(apiClientMock.updateEntry).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('GPT action pack')).toBeInTheDocument();
    expect(screen.getByLabelText('One focus')).toHaveValue('Pummel first');

    fireEvent.change(screen.getByLabelText('Correction note', { selector: '#confidence-note-leaks' }), {
      target: { value: 'Confirmed from video.' },
    });

    await user.click(screen.getByRole('button', { name: 'Finalize shared feedback' }));

    await waitFor(() => expect(apiClientMock.updateEntry).toHaveBeenCalledTimes(2));
    expect(apiClientMock.upsertEntryCheckoffEvidence).toHaveBeenCalledTimes(1);

    const finalCallPayload = apiClientMock.updateEntry.mock.calls[1]?.[1];
    expect(finalCallPayload.actionPackFinal.actionPack.oneFocus).toBe('Pummel first');
    expect(finalCallPayload.actionPackFinal.actionPack.confidenceFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'leaks', note: 'Confirmed from video.' }),
      ]),
    );
  });
});
