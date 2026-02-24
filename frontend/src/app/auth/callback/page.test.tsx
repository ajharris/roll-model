import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HostedUiCallbackPage from './page';

const replaceMock = vi.fn();
const useAuthMock = vi.fn();
const hydrateHostedUiTokensMock = vi.fn();
const exchangeHostedUiCodeForTokensMock = vi.fn();
const getHostedUiRuntimeConfigMock = vi.fn();
const parseHostedUiCallbackMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/cognitoHostedUi', () => ({
  HOSTED_UI_CALLBACK_PATH: '/auth/callback',
  hostedUiPkceVerifierKey: 'roll-model-hosted-ui-pkce-verifier',
  hostedUiStateKey: 'roll-model-hosted-ui-state',
  exchangeHostedUiCodeForTokens: (...args: unknown[]) =>
    exchangeHostedUiCodeForTokensMock(...args),
  getHostedUiRuntimeConfig: (...args: unknown[]) => getHostedUiRuntimeConfigMock(...args),
  parseHostedUiCallback: (...args: unknown[]) => parseHostedUiCallbackMock(...args),
}));

describe('HostedUiCallbackPage', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    useAuthMock.mockReset();
    hydrateHostedUiTokensMock.mockReset();
    exchangeHostedUiCodeForTokensMock.mockReset();
    getHostedUiRuntimeConfigMock.mockReset();
    parseHostedUiCallbackMock.mockReset();
    sessionStorage.clear();

    window.history.replaceState(null, '', '/auth/callback?code=abc123&state=state-1');

    getHostedUiRuntimeConfigMock.mockReturnValue({
      hasHostedUiConfig: true,
      enabled: true,
      clientId: 'client-123',
      domainUrl: 'https://example.auth.us-east-1.amazoncognito.com',
      signInRedirectUri: 'http://localhost:3000/auth/callback',
      signOutRedirectUri: 'http://localhost:3000/',
      validationErrors: [],
    });
    useAuthMock.mockReturnValue({
      hydrateHostedUiTokens: hydrateHostedUiTokensMock.mockReturnValue('athlete'),
    });
  });

  it('exchanges auth code, hydrates session, and redirects by role', async () => {
    const historyReplaceSpy = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);

    sessionStorage.setItem('roll-model-hosted-ui-state', 'state-1');
    sessionStorage.setItem('roll-model-hosted-ui-pkce-verifier', 'pkce-verifier');

    parseHostedUiCallbackMock.mockReturnValue({
      code: 'abc123',
      state: 'state-1',
      tokens: null,
      error: null,
      errorDescription: null,
    });
    exchangeHostedUiCodeForTokensMock.mockResolvedValue({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    hydrateHostedUiTokensMock.mockReturnValue('coach');

    render(<HostedUiCallbackPage />);

    await waitFor(() => {
      expect(exchangeHostedUiCodeForTokensMock).toHaveBeenCalled();
      expect(replaceMock).toHaveBeenCalledWith('/coach');
    });

    expect(parseHostedUiCallbackMock).toHaveBeenCalledWith(window.location.href);
    expect(exchangeHostedUiCodeForTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-123' }),
      'abc123',
      'pkce-verifier',
    );
    expect(hydrateHostedUiTokensMock).toHaveBeenCalledWith({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(sessionStorage.getItem('roll-model-hosted-ui-state')).toBeNull();
    expect(sessionStorage.getItem('roll-model-hosted-ui-pkce-verifier')).toBeNull();
    expect(historyReplaceSpy).toHaveBeenCalledWith(null, '', '/auth/callback');

    historyReplaceSpy.mockRestore();
  });

  it('shows an error when callback state validation fails', async () => {
    sessionStorage.setItem('roll-model-hosted-ui-state', 'expected-state');
    parseHostedUiCallbackMock.mockReturnValue({
      code: 'abc123',
      state: 'wrong-state',
      tokens: null,
      error: null,
      errorDescription: null,
    });

    render(<HostedUiCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Hosted UI callback state validation failed. Start sign-in again.'),
      ).toBeInTheDocument();
    });

    expect(exchangeHostedUiCodeForTokensMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('roll-model-hosted-ui-state')).toBeNull();
  });
});
