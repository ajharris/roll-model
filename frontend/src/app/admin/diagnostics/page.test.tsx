import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminDiagnosticsPage from './page';

const useAuthMock = vi.fn();

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

describe('AdminDiagnosticsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthMock.mockReset();

    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test/prod';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_pool123';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-123';

    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      role: 'admin',
      user: { email: 'admin@example.com', sub: 'admin-123' },
      tokens: { idToken: 'secret-id-token' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes('/entries')) {
          return Promise.resolve(new Response('{}', { status: 403, statusText: 'Forbidden' }));
        }
        if (url.includes('/export?mode=tidy')) {
          return Promise.resolve(new Response('{}', { status: 200, statusText: 'OK' }));
        }
        return Promise.resolve(new Response('{}', { status: 500, statusText: 'Unexpected' }));
      }),
    );
  });

  it('renders operational checks and runs live endpoint probes', async () => {
    render(<AdminDiagnosticsPage />);

    expect(screen.getByRole('heading', { name: 'Admin Diagnostics' })).toBeInTheDocument();
    expect(screen.getByText(/OK: Authenticated admin session/)).toBeInTheDocument();
    expect(screen.getByText(/OK: ID token present/)).toBeInTheDocument();
    expect(screen.getByText(/OK: API base URL valid/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText(/WARN: GET \/entries \(403 Forbidden\)/).length).toBeGreaterThan(0);
      expect(screen.getByText(/OK: GET \/export\?mode=tidy \(200 OK\)/)).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Triage summary' })).toBeInTheDocument();
    expect(screen.getByText(/Action: If 5xx\/network failure, check API Gateway\/Lambda health/)).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/entries',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/export?mode=tidy',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );

    expect(screen.queryByText('secret-id-token')).not.toBeInTheDocument();
  });
});
