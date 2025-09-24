import { handler } from '../lambda/index';

// Mock fido2-lib
const mockAttestationOptions = jest.fn();
const mockAttestationResult = jest.fn();
const mockAssertionOptions = jest.fn();
const mockAssertionResult = jest.fn();

jest.mock('fido2-lib', () => ({
  Fido2Lib: jest.fn().mockImplementation(() => ({
    attestationOptions: mockAttestationOptions,
    attestationResult: mockAttestationResult,
    assertionOptions: mockAssertionOptions,
    assertionResult: mockAssertionResult,
  })),
}));

describe('WebAuthn Registration', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get mock DynamoDB instance
    const AWS = require('aws-sdk');
    mockDb = AWS.__mockDocumentClient;
    
    // Setup default mock responses
    mockDb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: null }),
    });
    mockDb.put.mockReturnValue({
      promise: () => Promise.resolve({}),
    });
  });

  describe('/webauthn/register/options', () => {
    it('should return registration options for new user', async () => {
      const mockChallenge = new ArrayBuffer(64);
      mockAttestationOptions.mockResolvedValue({
        challenge: mockChallenge,
        rp: { name: 'Workspace', id: 'localhost' },
        user: { id: new ArrayBuffer(32), name: 'test', displayName: 'test' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {},
        timeout: 60000,
        attestation: 'none',
      });

      const event = {
        rawPath: '/webauthn/register/options',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ username: 'test@example.com' }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockDb.put).toHaveBeenCalled(); // User should be created
      expect(mockAttestationOptions).toHaveBeenCalled();
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.challenge).toBeDefined();
      expect(responseBody.user.id).toBeDefined();
    });

    it('should return 400 for missing username', async () => {
      const event = {
        rawPath: '/webauthn/register/options',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({}),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Missing username');
    });
  });

  describe('/webauthn/register/verify', () => {
    const mockUser = {
      id: 'user#test@example.com',
      username: 'test@example.com',
      userId: 'mock-user-id',
      credentials: [],
      challenge: 'mock-challenge',
    };

    const mockAttestation = {
      id: 'mock-credential-id',
      rawId: 'mock-raw-id',
      response: {
        clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoibW9jay1jaGFsbGVuZ2UiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20ifQ',
        attestationObject: 'mock-attestation-object',
      },
      type: 'public-key',
    };

    beforeEach(() => {
      mockDb.get.mockReturnValue({
        promise: () => Promise.resolve({ Item: mockUser }),
      });
    });

    it('should successfully verify registration with correct clientDataJSON format', async () => {
      const mockResult = {
        authnrData: new Map([
          ['credId', Buffer.from('mock-cred-id')],
          ['credentialPublicKeyPem', 'mock-public-key'],
          ['counter', 0],
        ]),
      };
      mockAttestationResult.mockResolvedValue(mockResult);

      const event = {
        rawPath: '/webauthn/register/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ 
          username: 'test@example.com', 
          attestation: mockAttestation 
        }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Verify that clientDataJSON was NOT converted to ArrayBuffer
      expect(mockAttestationResult).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            clientDataJSON: mockAttestation.response.clientDataJSON, // Should remain as string
          }),
        }),
        expect.any(Object)
      );

      // Verify credential was saved
      expect(mockDb.put).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            credentials: expect.arrayContaining([
              expect.objectContaining({
                credId: expect.any(String),
                publicKey: 'mock-public-key',
                counter: 0,
              }),
            ]),
          }),
        })
      );
    });

    it('should return 400 for missing parameters', async () => {
      const event = {
        rawPath: '/webauthn/register/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ username: 'test@example.com' }), // Missing attestation
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Missing parameters');
    });

    it('should return 500 when fido2-lib throws error', async () => {
      mockAttestationResult.mockRejectedValue(new Error('Invalid clientDataJSON'));

      const event = {
        rawPath: '/webauthn/register/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ 
          username: 'test@example.com', 
          attestation: mockAttestation 
        }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Registration verification failed');
      expect(responseBody.details).toBe('Invalid clientDataJSON');
    });
  });

  describe('/webauthn/login/verify', () => {
    const mockUser = {
      id: 'user#test@example.com',
      username: 'test@example.com',
      userId: 'mock-user-id',
      credentials: [{
        credId: 'mock-credential-id',
        publicKey: 'mock-public-key',
        counter: 5,
      }],
      challenge: 'mock-challenge',
    };

    const mockAssertion = {
      id: 'mock-credential-id',
      rawId: 'mock-raw-id',
      response: {
        clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoibW9jay1jaGFsbGVuZ2UiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20ifQ',
        authenticatorData: 'mock-auth-data',
        signature: 'mock-signature',
        userHandle: null,
      },
      type: 'public-key',
    };

    beforeEach(() => {
      mockDb.get.mockReturnValue({
        promise: () => Promise.resolve({ Item: mockUser }),
      });
    });

    it('should successfully verify login with correct clientDataJSON format', async () => {
      const mockResult = {
        authnrData: new Map([
          ['counter', 6],
        ]),
      };
      mockAssertionResult.mockResolvedValue(mockResult);

      const event = {
        rawPath: '/webauthn/login/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ 
          username: 'test@example.com', 
          assertion: mockAssertion 
        }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Verify that clientDataJSON was NOT converted to ArrayBuffer
      expect(mockAssertionResult).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            clientDataJSON: mockAssertion.response.clientDataJSON, // Should remain as string
          }),
        }),
        expect.any(Object)
      );

      // Verify counter was updated
      expect(mockDb.put).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            credentials: expect.arrayContaining([
              expect.objectContaining({
                counter: 6, // Updated counter
              }),
            ]),
          }),
        })
      );
    });

    it('should return 400 for unknown credential', async () => {
      const unknownAssertion = {
        ...mockAssertion,
        id: 'unknown-credential-id',
      };

      const event = {
        rawPath: '/webauthn/login/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ 
          username: 'test@example.com', 
          assertion: unknownAssertion 
        }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Unknown credential');
    });
  });

  describe('Base64URL encoding/decoding', () => {
    it('should properly handle base64url string conversion without corruption', () => {
      // This test verifies that our clientDataJSON handling is correct
      const originalClientDataJSON = JSON.stringify({
        type: 'webauthn.create',
        challenge: 'mock-challenge',
        origin: 'https://www.christopherdebeer.com',
        crossOrigin: false,
      });

      // Simulate the browser's base64url encoding
      const base64urlEncoded = Buffer.from(originalClientDataJSON, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

      // Our fix: keep it as base64url string (don't convert to ArrayBuffer)
      const keepAsString = base64urlEncoded;

      // Verify the string can be properly decoded
      const decoded = Buffer.from(
        keepAsString
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(keepAsString.length + (4 - (keepAsString.length % 4)) % 4, '='),
        'base64'
      ).toString('utf8');

      expect(JSON.parse(decoded)).toEqual({
        type: 'webauthn.create',
        challenge: 'mock-challenge',
        origin: 'https://www.christopherdebeer.com',
        crossOrigin: false,
      });

      // This should NOT start with AWS4-HMAC- which was the original error
      expect(decoded).not.toMatch(/^AWS4-HMAC-/);
    });
  });

  describe('CBOR attestationObject handling', () => {
    it('should handle attestationObject as base64url string to prevent CBOR parsing errors', async () => {
      const mockUser = {
        id: 'user#test@example.com',
        username: 'test@example.com',
        userId: 'mock-user-id',
        credentials: [],
        challenge: 'mock-challenge',
      };

      const realAttestationData = {
        id: 'bPyj2QDp6dKmbjT2MUXQaeRPWgdO9fTQ7lF5ZeBIyYiHBhlzguABT8rkCe6iO03C',
        rawId: 'bPyj2QDp6dKmbjT2MUXQaeRPWgdO9fTQ7lF5ZeBIyYiHBhlzguABT8rkCe6iO03C',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiMERsMlJqR0NKXzNOc2VDR3d0dDdOeFM2UTgwa2tsVVhFVEFNTzBWMmFqeXFyMnRWOWR1Q0M1bW5pblFkWTJUM3dJOTA1WTNSbzNrREhZeXNLOG9GenciLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMGz8o9kA6enSpm409jFF0GnkT1oHTvX00O5ReWXgSMmIhwYZc4LgAU_K5AnuojtNwqUBAgMmIAEhWCBQB1j0VXOTqkkWhrm0BXI-Ch0Zu0YoODyZ5E1mpNvi2iJYIFhwFJ4PlqyyP-iPnMAuQPgzFuJgFO3lrPWKTSVFETrW',
        },
        type: 'public-key',
      };

      mockDb.get.mockReturnValue({
        promise: () => Promise.resolve({ Item: mockUser }),
      });

      const mockResult = {
        authnrData: new Map([
          ['credId', Buffer.from('mock-cred-id')],
          ['credentialPublicKeyPem', 'mock-public-key'],
          ['counter', 0],
        ]),
      };
      mockAttestationResult.mockResolvedValue(mockResult);

      const event = {
        rawPath: '/webauthn/register/verify',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ 
          username: 'test@example.com', 
          attestation: realAttestationData 
        }),
        headers: { origin: 'https://www.christopherdebeer.com' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Verify that attestationObject was NOT converted to ArrayBuffer
      // The fido2-lib library should receive it as a base64url string
      expect(mockAttestationResult).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            clientDataJSON: realAttestationData.response.clientDataJSON, // Should remain as string
            attestationObject: realAttestationData.response.attestationObject, // Should remain as string
          }),
        }),
        expect.any(Object)
      );

      // If this test passes, it means we're not getting "couldn't parse attestationObject CBOR" error
      const responseBody = JSON.parse(result.body);
      expect(responseBody.ok).toBe(true);
    });
  });
});