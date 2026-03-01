import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackPage from './page';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    submitFeedback: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: apiClientMock,
}));

describe('FeedbackPage', () => {
  beforeEach(() => {
    apiClientMock.submitFeedback.mockReset();
    apiClientMock.chat.mockReset();
    apiClientMock.submitFeedback.mockResolvedValue({
      feedbackId: 'feedback-1',
      issueNumber: 55,
      issueUrl: 'https://github.com/example/repo/issues/55',
    });
  });

  it('requires preview before final submit and posts structured payload', async () => {
    const user = userEvent.setup();
    render(<FeedbackPage />);

    await user.type(screen.getByLabelText('Problem'), 'Submitting from iOS silently fails after loading spinner.');
    await user.type(
      screen.getByLabelText('Proposed change'),
      'Disable submit while pending and show a persistent inline error with retry.',
    );
    await user.type(
      screen.getByLabelText('Reproduction steps / context'),
      'Open Safari on iPhone, fill required fields, tap submit on low connectivity.',
    );
    await user.type(screen.getByLabelText('Screenshot URL #1'), 'https://example.com/shot.png');

    await user.click(screen.getByRole('button', { name: 'Preview payload' }));
    expect(await screen.findByText('Final preview')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await waitFor(() => expect(apiClientMock.submitFeedback).toHaveBeenCalledTimes(1));
    expect(apiClientMock.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        previewConfirmed: true,
        severity: 'medium',
        screenshots: [{ url: 'https://example.com/shot.png', caption: '' }],
      }),
    );
  });

  it('normalizes feedback fields with GPT', async () => {
    const user = userEvent.setup();
    render(<FeedbackPage />);

    await user.type(screen.getByLabelText('Problem'), 'app broken');
    await user.type(screen.getByLabelText('Proposed change'), 'fix it better');
    await user.type(screen.getByLabelText('Reproduction steps / context'), 'I clicked and stuff happened.');

    apiClientMock.chat.mockResolvedValueOnce({
      assistant_text: JSON.stringify({
        problem: 'On iOS Safari the submit button can appear unresponsive after request timeout.',
        proposedChange: 'Add explicit loading/error states and retry affordance for failed submissions.',
        contextSteps: 'Use iPhone Safari, tap submit on weak network, observe no visible error state.',
      }),
      suggested_prompts: [],
    });

    await user.click(screen.getByRole('button', { name: 'Normalize with GPT' }));

    await waitFor(() => expect(apiClientMock.chat).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Problem')).toHaveValue(
      'On iOS Safari the submit button can appear unresponsive after request timeout.',
    );
    expect(screen.getByLabelText('Proposed change')).toHaveValue(
      'Add explicit loading/error states and retry affordance for failed submissions.',
    );
  });
});
