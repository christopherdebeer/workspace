module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/lambda'],
  testMatch: ['**/*simple*.test.ts', '**/*webauthn*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
};