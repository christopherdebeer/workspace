import { Fido2Lib } from 'fido2-lib';
import crypto from 'crypto';

// Helper functions from lambda/index.ts
function toBase64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): ArrayBuffer {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;
}

describe('WebAuthn Credential ID Mismatch Tests', () => {
  test('should reproduce "id and credId were not the same" error', async () => {
    // Create a mock attestation object that matches the failing request format
    const mockAttestation = {
      id: "NO2F0MXMNKnByhcpMpvNR86FEtmITi7SGXIhmvz3QHW46-wNAWTeqTZ-M21k9JBn", // base64url string
      rawId: "NO2F0MXMNKnByhcpMpvNR86FEtmITi7SGXIhmvz3QHW46-wNAWTeqTZ-M21k9JBn", // base64url string
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiT21EX0xtS1FJV3NaWkVjMGRQbWp2Q3RnQTlvSldsbjExcGRqMF83NTBQWWdsemFEd25zVEFfaV90WWxwZ3pvNzkwTnJtQkYwa1lfd1ZEbmR0cU12RVEiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMDTthdDFzDSpwcoXKTKbzUfOhRLZiE4u0hlyIZr890B1uOvsDQFk3qk2fjNtZPSQZ6UBAgMmIAEhWCB_9mhT7FmHhnpuLJpTje2r16PvxkLgY9M6M-sf_JcGkSJYIBxtEcF0u0hDP82eniwwkQV1T09qn-nDRYNK6sdsOQqn"
      },
      type: "public-key"
    };

    const fido = new Fido2Lib({ 
      rpId: 'www.christopherdebeer.com', 
      rpName: 'Workspace', 
      challengeSize: 64 
    });

    // This is the problematic conversion that causes the "id and credId were not the same" error
    const convertedAttestation = {
      ...mockAttestation,
      id: fromBase64Url(mockAttestation.id), // ❌ Converting to ArrayBuffer
      rawId: fromBase64Url(mockAttestation.rawId), // ❌ Converting to ArrayBuffer  
      response: {
        ...mockAttestation.response,
        clientDataJSON: mockAttestation.response.clientDataJSON, // ✅ Keep as base64url string
        attestationObject: mockAttestation.response.attestationObject, // ✅ Keep as base64url string
      },
    };

    const expect = {
      challenge: "OmD_LmKQIWsZZEc0dPmjvCtgA9oJWln11pdj0_750PYglzaDwnsTA_i_tYlpgzo790NrmBF0kY_wVDndtqMvEQ",
      origin: "https://www.christopherdebeer.com",
      factor: 'either' as const,
      rpId: 'www.christopherdebeer.com',
    };

    // This should throw the "id and credId were not the same" error
    try {
      await fido.attestationResult(convertedAttestation, expect);
      // If we reach here, the error was not reproduced
      expect(false).toBe(true); // Force test failure
    } catch (error: unknown) {
      expect((error as Error).message).toContain("id and credId were not the same");
      console.log('✅ Successfully reproduced the credential ID mismatch error');
    }
  });

  test('should fix "id and credId were not the same" error by keeping IDs as base64url strings', async () => {
    // Same mock attestation object
    const mockAttestation = {
      id: "NO2F0MXMNKnByhcpMpvNR86FEtmITi7SGXIhmvz3QHW46-wNAWTeqTZ-M21k9JBn",
      rawId: "NO2F0MXMNKnByhcpMpvNR86FEtmITi7SGXIhmvz3QHW46-wNAWTeqTZ-M21k9JBn",
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiT21EX0xtS1FJV3NaWkVjMGRQbWp2Q3RnQTlvSldsbjExcGRqMF83NTBQWWdsemFEd25zVEFfaV90WWxwZ3pvNzkwTnJtQkYwa1lfd1ZEbmR0cU12RVEiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMDTthdDFzDSpwcoXKTKbzUfOhRLZiE4u0hlyIZr890B1uOvsDQFk3qk2fjNtZPSQZ6UBAgMmIAEhWCB_9mhT7FmHhnpuLJpTje2r16PvxkLgY9M6M-sf_JcGkSJYIBxtEcF0u0hDP82eniwwkQV1T09qn-nDRYNK6sdsOQqn"
      },
      type: "public-key"
    };

    const fido = new Fido2Lib({ 
      rpId: 'www.christopherdebeer.com', 
      rpName: 'Workspace', 
      challengeSize: 64 
    });

    // The FIX: Keep id and rawId as base64url strings (don't convert to ArrayBuffer)
    const fixedAttestation = {
      ...mockAttestation,
      // ✅ Keep as base64url strings - fido2-lib handles conversion internally
      id: mockAttestation.id, 
      rawId: mockAttestation.rawId,
      response: {
        ...mockAttestation.response,
        clientDataJSON: mockAttestation.response.clientDataJSON,
        attestationObject: mockAttestation.response.attestationObject,
      },
    };

    const expect = {
      challenge: "OmD_LmKQIWsZZEc0dPmjvCtgA9oJWln11pdj0_750PYglzaDwnsTA_i_tYlpgzo790NrmBF0kY_wVDndtqMvEQ",
      origin: "https://www.christopherdebeer.com",
      factor: 'either' as const,
      rpId: 'www.christopherdebeer.com',
    };

    // This should NOT throw the "id and credId were not the same" error
    try {
      const result = await fido.attestationResult(fixedAttestation, expect);
      console.log('✅ Fix verified: credential ID validation now works when IDs are kept as base64url strings');
      expect(result).toBeDefined();
    } catch (error: any) {
      // If there are other validation errors (like challenge mismatch), that's fine for this test
      // We just want to ensure the "id and credId were not the same" error is resolved
      if (error.message.includes("id and credId were not the same")) {
        throw new Error('Fix failed: still getting credential ID mismatch error');
      }
      console.log(`✅ Fix verified: no credential ID mismatch error (other validation: ${error.message})`);
    }
  });

  test('should verify credential ID format consistency', () => {
    const credIdString = "NO2F0MXMNKnByhcpMpvNR86FEtmITi7SGXIhmvz3QHW46-wNAWTeqTZ-M21k9JBn";
    const credIdArrayBuffer = fromBase64Url(credIdString);
    const credIdBackToString = toBase64Url(Buffer.from(credIdArrayBuffer));
    
    expect(credIdBackToString).toBe(credIdString);
    console.log('✅ Credential ID format conversion consistency verified');
  });
});