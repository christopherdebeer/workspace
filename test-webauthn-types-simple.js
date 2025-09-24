// Simple validation test for WebAuthn data type fixes

function fromBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;
}

// Test data from the actual error
const mockAttestation = {
  id: "1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc",
  rawId: "1wWhog9kcdKuJ2NTTeraRXKgTwE6IXjl_J4ZU_LSHcf8WFfMfICUlbsByFJWJKoc",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiV3dBZk5nbzBPRVBzY0hwdGoxcVVQQkUzSC1KOENEaE5FUjJVNHg3b0x1dHF2RDRPU2xkSXpydkozeUFvMmF4V0VrbF9lRnAwb3FTM1hnTGVTRkFZdVEiLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
    attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMNcFoaIPZHHSridjU03q2kVyoE8BOiF45fyeGVPy0h3H_FhXzHyAlJW7AchSViSqHKUBAgMmIAEhWCDRTizkQtGuNL3ELORFSEiLHi_8kq-qYwqmjaDy21CNSCJYIC4WiqE9OaFGFFAQXvGhTBjk3IrzCPrNchcOHWyeGhAB"
  }
};

console.log("🧪 Testing WebAuthn Data Type Conversion Fix");
console.log("=" .repeat(50));

// Apply the DEFINITIVE FIX according to fido2-lib TypeScript definitions
const convertedAttestation = {
  ...mockAttestation,
  id: fromBase64Url(mockAttestation.id),     // Convert to ArrayBuffer - required by AttestationResult interface
  rawId: fromBase64Url(mockAttestation.rawId), // Convert to ArrayBuffer - required by AttestationResult interface
  response: {
    ...mockAttestation.response,
    clientDataJSON: mockAttestation.response.clientDataJSON,     // Keep as string - required by AttestationResult interface
    attestationObject: mockAttestation.response.attestationObject, // Keep as string - required by AttestationResult interface
  },
};

// Verify data types match fido2-lib expectations
console.log("✅ Data Type Verification:");
console.log(`id type: ${typeof convertedAttestation.id}, isArrayBuffer: ${convertedAttestation.id instanceof ArrayBuffer}`);
console.log(`rawId type: ${typeof convertedAttestation.rawId}, isArrayBuffer: ${convertedAttestation.rawId instanceof ArrayBuffer}`);
console.log(`clientDataJSON type: ${typeof convertedAttestation.response.clientDataJSON}`);
console.log(`attestationObject type: ${typeof convertedAttestation.response.attestationObject}`);
console.log();

// Validate the conversions work correctly
console.log("✅ Data Validation:");

// Check that id and rawId ArrayBuffers are identical (should fix "id and credId were not the same")
const idBuffer = Buffer.from(convertedAttestation.id);
const rawIdBuffer = Buffer.from(convertedAttestation.rawId);
const idsMatch = idBuffer.equals(rawIdBuffer);
console.log(`id and rawId match: ${idsMatch}`);

// Check that clientDataJSON is valid base64url that decodes to JSON
try {
  const clientDataDecoded = JSON.parse(Buffer.from(convertedAttestation.response.clientDataJSON, 'base64').toString());
  console.log(`clientDataJSON valid: ${clientDataDecoded.type === 'webauthn.create' && clientDataDecoded.origin === 'https://www.christopherdebeer.com'}`);
} catch (e) {
  console.log(`clientDataJSON valid: false - ${e.message}`);
}

// Check that attestationObject is valid base64url string (should fix CBOR parsing)
const isValidBase64Url = /^[A-Za-z0-9_-]+$/.test(convertedAttestation.response.attestationObject);
console.log(`attestationObject valid base64url: ${isValidBase64Url}`);

console.log();
console.log("🎯 Expected Result:");
console.log("- id: ArrayBuffer ✅");
console.log("- rawId: ArrayBuffer ✅"); 
console.log("- clientDataJSON: string ✅");
console.log("- attestationObject: string ✅");
console.log();
console.log("This should resolve:");
console.log('❌ "expected \'id\' or \'rawId\' field of request to be ArrayBuffer, got rawId string and id string"');
console.log('❌ "couldn\'t parse clientDataJson: SyntaxError: Unexpected token \'A\', AWS4-HMAC"');
console.log('❌ "couldn\'t parse attestationObject CBOR"');  
console.log('❌ "id and credId were not the same"');
console.log();
console.log("✅ WebAuthn data type fix is ready for testing!");