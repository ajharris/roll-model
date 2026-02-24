'use client';

import { useEffect } from 'react';

import { logRenderError } from '@/lib/clientErrorLogging';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logRenderError(error, { source: 'frontend/src/app/error.tsx' });
  }, [error]);

  return (
    <section role="alert" aria-live="assertive">
      <h2>Something went wrong</h2>
      <p>We hit an unexpected error while loading this page.</p>
      <div className="row">
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </section>
  );
}
