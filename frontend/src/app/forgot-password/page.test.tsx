import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ForgotPasswordPage from './page';

const forgotPasswordMock = vi.fn();
const confirmPasswordMock = vi.fn();
const cognitoUserPoolCtorMock = vi.fn();
const cognitoUserCtorMock = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/config', () => ({
  frontendConfig: {
    cognitoUserPoolId: 'us-east-1_pool123',
    cognitoClientId: 'client-123',
  },
}));

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: function MockCognitoUserPool(args: unknown) {
    cognitoUserPoolCtorMock(args);
  },
  CognitoUser: function MockCognitoUser(args: unknown) {
    cognitoUserCtorMock(args);
    return {
      forgotPassword: forgotPasswordMock,
      confirmPassword: confirmPasswordMock,
    };
  },
}));

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    forgotPasswordMock.mockImplementation((callbacks: { inputVerificationCode?: () => void }) => {
      callbacks.inputVerificationCode?.();
    });
    confirmPasswordMock.mockImplementation(
      (_code: string, _password: string, callbacks: { onSuccess?: () => void }) => {
        callbacks.onSuccess?.();
      },
    );
  });

  it('sends a reset email request and confirms a new password', async () => {
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email or username'), {
      target: { value: 'athlete@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));

    await waitFor(() => {
      expect(screen.getByText(/Reset instructions were sent to the email on file/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => {
      expect(screen.getByText('Password updated. Return to sign in with your new password.')).toBeInTheDocument();
    });

    expect(cognitoUserPoolCtorMock).toHaveBeenCalledWith({
      UserPoolId: 'us-east-1_pool123',
      ClientId: 'client-123',
    });
    expect(cognitoUserCtorMock).toHaveBeenCalled();
    expect(forgotPasswordMock).toHaveBeenCalled();
    expect(confirmPasswordMock).toHaveBeenCalledWith(
      '123456',
      'NewPassword123!',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onFailure: expect.any(Function),
      }),
    );
  });
});
