import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

process.env.NEXT_PUBLIC_API_BASE_URL ??= 'https://api.example.test';
process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ??= 'us-east-1_pool-test';
process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ??= 'client-test';

afterEach(() => {
  cleanup();
});
