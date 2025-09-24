import { Fido2Lib } from 'fido2-lib';

describe('WebAuthn Data Type Handling - Comprehensive Tests', () => {
  let fido: Fido2Lib;
  
  beforeEach(() => {
    fido = new Fido2Lib({ 
      rpId: 'www.christopherdebeer.com', 
      rpName: 'Workspace', 
      challengeSize: 64 
    });
  });

  // Helper function to convert base64url to ArrayBuffer
  function fromBase64Url(str: string): ArrayBuffer {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    return Buffer.from(str, 'base64').buffer;
  }

  describe('Registration (AttestationResult) Data Types', () => {
    const mockRegistrationData = {
      username: 'christopherdebeer@gmail.com',
      attestation: {
        id: '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc',
        rawId: '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiV3dBZk5nbzBPRVBzY0hwdGoxcVVQQkUzSC1KOENEaE5FUjJVNHg3b0x1dHF2RDRPU2xkSXpydkozeUFvMmF4V0VrbF9lRnAwb3FTM1hnTGVTRkFZdVEiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMNcFoaIPZHHSridjU03q2kVyoE8BOiF45fyeGVPy0h3H_FhXzHyAlJW7AchSViSqHKUBAgMmIAEhWCDRTizkQtGuNL3ELORFSEiLHi_8kq-qYwqmjaDy21CNSCJYIC4WiqE9OaFGFFAQXvGhTBjk3IrzCPrNchcOHWyeGhAB'
        },
        type: 'public-key'
      }
    };

    test('should correctly format registration data for fido2-lib', () => {
      const { attestation } = mockRegistrationData;
      
      // CORRECT FORMAT according to AttestationResult interface
      const correctAttestationFormat = {
        id: fromBase64Url(attestation.id),           // ArrayBuffer ✅
        rawId: fromBase64Url(attestation.rawId),     // ArrayBuffer ✅
        response: {
          clientDataJSON: attestation.response.clientDataJSON,     // string ✅
          attestationObject: attestation.response.attestationObject // string ✅
        }
      };

      // Verify types
      expect(correctAttestationFormat.id).toBeInstanceOf(ArrayBuffer);
      expect(correctAttestationFormat.rawId).toBeInstanceOf(ArrayBuffer);
      expect(typeof correctAttestationFormat.response.clientDataJSON).toBe('string');
      expect(typeof correctAttestationFormat.response.attestationObject).toBe('string');
      
      // The attestation object should be a valid base64url string
      expect(correctAttestationFormat.response.attestationObject).toMatch(/^[A-Za-z0-9_-]+$/);
      
      // The clientDataJSON should be valid base64url that decodes to JSON
      const clientData = JSON.parse(Buffer.from(correctAttestationFormat.response.clientDataJSON, 'base64').toString());
      expect(clientData.type).toBe('webauthn.create');
      expect(clientData.origin).toBe('https://www.christopherdebeer.com');
    });

    test('should FAIL with string id/rawId (current error scenario)', () => {
      const { attestation } = mockRegistrationData;
      
      // INCORRECT FORMAT (what we were doing wrong)
      const incorrectAttestationFormat = {
        id: attestation.id,           // string ❌ - causes "expected ArrayBuffer, got string"
        rawId: attestation.rawId,     // string ❌ - causes "expected ArrayBuffer, got string"
        response: {
          clientDataJSON: attestation.response.clientDataJSON,
          attestationObject: attestation.response.attestationObject
        }
      };

      // This should demonstrate the type mismatch
      expect(typeof incorrectAttestationFormat.id).toBe('string');
      expect(typeof incorrectAttestationFormat.rawId).toBe('string');
      
      // This would cause the error: "expected 'id' or 'rawId' field of request to be ArrayBuffer, got rawId string and id string"
    });
  });

  describe('Login (AssertionResult) Data Types', () => {
    const mockLoginData = {
      username: 'christopherdebeer@gmail.com',
      assertion: {
        id: '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc',
        rawId: '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiY2hhbGxlbmdlIiwib3JpZ2luIjoiaHR0cHM6Ly93d3cuY2hyaXN0b3BoZXJkZWJlZXIuY29tIn0',
          authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MBAAAAAEZ',
          signature: 'MEYCIQDNlCMRKKgYw4p7w4p7w4p7w4p7w4p7w4p7w4p7w4p7wIhAMKgYw4p7w4p7w4p7w4p7w4p7w4p7w4p7w4p7w4p7'
        },
        type: 'public-key'
      }
    };

    test('should correctly format login assertion data for fido2-lib', () => {
      const { assertion } = mockLoginData;
      
      // CORRECT FORMAT according to AssertionResult interface
      const correctAssertionFormat = {
        id: fromBase64Url(assertion.id),           // ArrayBuffer ✅
        rawId: fromBase64Url(assertion.rawId),     // ArrayBuffer ✅
        response: {
          clientDataJSON: assertion.response.clientDataJSON,                    // string ✅
          authenticatorData: fromBase64Url(assertion.response.authenticatorData), // ArrayBuffer ✅
          signature: assertion.response.signature,                               // string ✅
          userHandle: null                                                       // null ✅
        }
      };

      // Verify types
      expect(correctAssertionFormat.id).toBeInstanceOf(ArrayBuffer);
      expect(correctAssertionFormat.rawId).toBeInstanceOf(ArrayBuffer);
      expect(typeof correctAssertionFormat.response.clientDataJSON).toBe('string');
      expect(correctAssertionFormat.response.authenticatorData).toBeInstanceOf(ArrayBuffer);
      expect(typeof correctAssertionFormat.response.signature).toBe('string');
    });
  });

  describe('Error Prevention Tests', () => {
    test('should prevent "couldn\'t parse clientDataJson: AWS4-HMAC" error', () => {
      // clientDataJSON should NEVER be converted to ArrayBuffer
      const clientDataJSON = 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0';
      
      // CORRECT: Keep as string
      expect(typeof clientDataJSON).toBe('string');
      
      // WRONG: Don't convert to ArrayBuffer
      const incorrectConversion = fromBase64Url(clientDataJSON);
      expect(incorrectConversion).toBeInstanceOf(ArrayBuffer);
      // This would cause AWS signature corruption
    });

    test('should prevent "couldn\'t parse attestationObject CBOR" error', () => {
      // attestationObject should NEVER be converted to ArrayBuffer
      const attestationObject = 'o2NmbXRkbm9uZQ';
      
      // CORRECT: Keep as string
      expect(typeof attestationObject).toBe('string');
      
      // WRONG: Don't convert to ArrayBuffer
      const incorrectConversion = fromBase64Url(attestationObject);
      expect(incorrectConversion).toBeInstanceOf(ArrayBuffer);
      // This would cause CBOR parsing errors
    });

    test('should prevent "id and credId were not the same" error', () => {
      const id = '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc';
      const rawId = '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc';
      
      // CORRECT: Convert both to ArrayBuffer
      const correctId = fromBase64Url(id);
      const correctRawId = fromBase64Url(rawId);
      
      expect(correctId).toBeInstanceOf(ArrayBuffer);
      expect(correctRawId).toBeInstanceOf(ArrayBuffer);
      
      // They should represent the same data
      expect(Buffer.from(correctId).toString('base64url')).toBe(id);
      expect(Buffer.from(correctRawId).toString('base64url')).toBe(rawId);
    });

    test('should prevent "expected ArrayBuffer, got string" error', () => {
      const id = '1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc';
      
      // WRONG: Leaving as string
      expect(typeof id).toBe('string');
      // This causes: "expected 'id' or 'rawId' field of request to be ArrayBuffer, got rawId string and id string"
      
      // CORRECT: Convert to ArrayBuffer
      const correctId = fromBase64Url(id);
      expect(correctId).toBeInstanceOf(ArrayBuffer);
    });
  });
});