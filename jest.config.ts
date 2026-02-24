import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/backend', '<rootDir>/infrastructure'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true
};

export default config;
