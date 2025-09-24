module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*simple*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
};