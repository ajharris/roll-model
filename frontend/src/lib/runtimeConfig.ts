import { getFrontendConfig, type FrontendConfig } from '@/lib/config';

export type FrontendRuntimeConfig = FrontendConfig;

export const getFrontendRuntimeConfig = (): FrontendRuntimeConfig => getFrontendConfig();
