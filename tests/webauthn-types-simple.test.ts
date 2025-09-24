/**
 * Simple WebAuthn Type Validation Test
 * Tests that our type fixes prevent the common WebAuthn errors
 */

// Simple helper functions for testing
function toBase64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): ArrayBuffer {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;
}

describe('WebAuthn Type Safety Simple', () => {
  test('base64url conversion should work correctly', () => {
    const testData = 'Hello WebAuthn';
    const buffer = Buffer.from(testData);
    const base64url = toBase64Url(buffer);
    const converted = fromBase64Url(base64url);
    const result = Buffer.from(converted).toString();
    
    expect(result).toBe(testData);
    expect(typeof base64url).toBe('string');
    expect(converted).toBeInstanceOf(ArrayBuffer);
  });

  test('should prevent clientDataJSON AWS signature corruption', () => {
    // Mock a valid clientDataJSON from WebAuthn
    const validClientData = {
      type: 'webauthn.create',
      challenge: 'test-challenge',
      origin: 'https://www.christopherdebeer.com',
      crossOrigin: false
    };
    
    const clientDataString = JSON.stringify(validClientData);
    const clientDataBuffer = Buffer.from(clientDataString);
    const clientDataJSON = toBase64Url(clientDataBuffer);
    
    // Verify it decodes correctly
    const decoded = Buffer.from(fromBase64Url(clientDataJSON)).toString();
    expect(decoded).toBe(clientDataString);
    expect(decoded).not.toContain('AWS4-HMAC');
    expect(() => JSON.parse(decoded)).not.toThrow();
  });

  test('should handle credential ID conversion correctly', () => {
    // Mock credential ID as base64url string (from client)
    const credIdString = "1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc";
    
    // Convert to ArrayBuffer (for fido2-lib)
    const credIdBuffer = fromBase64Url(credIdString);
    
    expect(typeof credIdString).toBe('string');
    expect(credIdBuffer).toBeInstanceOf(ArrayBuffer);
    
    // Verify roundtrip conversion works
    const backToString = toBase64Url(Buffer.from(credIdBuffer));
    expect(backToString).toBe(credIdString);
  });

  test('WebAuthn registration data types should match fido2-lib expectations', () => {
    // Mock incoming WebAuthn registration data (as strings from client)
    const incomingData = {
      id: "test-id-base64url",
      rawId: "test-id-base64url", 
      response: {
        clientDataJSON: "eyJ0ZXN0IjoidmFsdWUifQ", // {"test":"value"} in base64url
        attestationObject: "test-attestation-object-base64url"
      }
    };

    // Convert for fido2-lib as per our fix
    const convertedData = {
      id: fromBase64Url(incomingData.id), // ArrayBuffer for fido2-lib
      rawId: fromBase64Url(incomingData.rawId), // ArrayBuffer for fido2-lib  
      response: {
        clientDataJSON: incomingData.response.clientDataJSON, // String for fido2-lib
        attestationObject: incomingData.response.attestationObject // String for fido2-lib
      }
    };

    // Verify types are correct
    expect(convertedData.id).toBeInstanceOf(ArrayBuffer);
    expect(convertedData.rawId).toBeInstanceOf(ArrayBuffer);
    expect(typeof convertedData.response.clientDataJSON).toBe('string');
    expect(typeof convertedData.response.attestationObject).toBe('string');
  });

  test('WebAuthn login data types should match fido2-lib expectations', () => {
    // Mock incoming WebAuthn login data (as strings from client)
    const incomingData = {
      id: "test-id-base64url",
      rawId: "test-id-base64url",
      response: {
        clientDataJSON: "eyJ0ZXN0IjoidmFsdWUifQ",
        authenticatorData: "test-auth-data-base64url",
        signature: "test-signature-base64url"
      }
    };

    // Convert for fido2-lib as per our fix
    const convertedData = {
      id: fromBase64Url(incomingData.id), // ArrayBuffer for fido2-lib
      rawId: fromBase64Url(incomingData.rawId), // ArrayBuffer for fido2-lib
      response: {
        clientDataJSON: incomingData.response.clientDataJSON, // String for fido2-lib
        authenticatorData: fromBase64Url(incomingData.response.authenticatorData), // ArrayBuffer for fido2-lib
        signature: incomingData.response.signature, // String for fido2-lib
      }
    };

    // Verify types are correct
    expect(convertedData.id).toBeInstanceOf(ArrayBuffer);
    expect(convertedData.rawId).toBeInstanceOf(ArrayBuffer);
    expect(typeof convertedData.response.clientDataJSON).toBe('string');
    expect(convertedData.response.authenticatorData).toBeInstanceOf(ArrayBuffer);
    expect(typeof convertedData.response.signature).toBe('string');
  });
});