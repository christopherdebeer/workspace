module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*simple*.test.ts', '**/*comprehensive*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
};