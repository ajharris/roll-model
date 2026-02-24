import { render, screen } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AdminPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AdminPage', () => {
  it('renders links to diagnostics and config health tools', () => {
    render(<AdminPage />);

    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open diagnostics' })).toHaveAttribute(
      'href',
      '/admin/diagnostics',
    );
    expect(screen.getByRole('link', { name: 'Open config health' })).toHaveAttribute(
      'href',
      '/admin/config-health',
    );
  });
});
