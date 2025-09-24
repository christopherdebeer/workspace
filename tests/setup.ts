// Test setup file for Jest
// Global test configuration and mocks go here

// Mock AWS SDK
jest.mock('aws-sdk', () => {
  const mockDocumentClient = {
    get: jest.fn(),
    put: jest.fn(),
  };
  
  return {
    DynamoDB: {
      DocumentClient: jest.fn(() => mockDocumentClient),
    },
    __mockDocumentClient: mockDocumentClient,
  };
});

// Mock crypto module
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.from('mock-random-bytes-12345678901234567890')),
}));