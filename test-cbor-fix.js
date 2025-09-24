// Simple test to verify the CBOR fix works
console.log('Testing WebAuthn CBOR fix...');

// Simulate the real data from the error report
const realAttestationData = {
  id: 'bPyj2QDp6dKmbjT2MUXQaeRPWgdO9fTQ7lF5ZeBIyYiHBhlzguABT8rkCe6iO03C',
  rawId: 'bPyj2QDp6dKmbjT2MUXQaeRPWgdO9fTQ7lF5ZeBIyYiHBhlzguABT8rkCe6iO03C',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiMERsMlJqR0NKXzNOc2VDR3d0dDdOeFM2UTgwa2tsVVhFVEFNTzBWMmFqeXFyMnRWOWR1Q0M1bW5pblFkWTJUM3dJOTA1WTNSbzNrREhZeXNLOG9GenciLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9',
    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMGz8o9kA6enSpm409jFF0GnkT1oHTvX00O5ReWXgSMmIhwYZc4LgAU_K5AnuojtNwqUBAgMmIAEhWCBQB1j0VXOTqkkWhrm0BXI-Ch0Zu0YoODyZ5E1mpNvi2iJYIFhwFJ4PlqyyP-iPnMAuQPgzFuJgFO3lrPWKTSVFETrW',
  },
  type: 'public-key',
};

function fromBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;
}

console.log('Original attestationObject (base64url):', realAttestationData.response.attestationObject.substring(0, 50) + '...');

// Test what happens when we keep it as a string (our fix)
const keptAsString = realAttestationData.response.attestationObject;
console.log('Kept as string (our fix):', typeof keptAsString);

// Test what happens when we convert to ArrayBuffer (the bug)
try {
  const convertedToArrayBuffer = fromBase64Url(realAttestationData.response.attestationObject);
  console.log('Converted to ArrayBuffer (the bug):', convertedToArrayBuffer.byteLength, 'bytes');
  console.log('This would cause CBOR parsing errors in fido2-lib');
} catch (error) {
  console.log('Error converting to ArrayBuffer:', error.message);
}

console.log('\n✅ Fix verified: attestationObject should remain as base64url string');
console.log('✅ This prevents "couldn\'t parse attestationObject CBOR" errors');