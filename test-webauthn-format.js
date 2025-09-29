// Test WebAuthn data format without running full verification
const { Fido2Lib } = require('fido2-lib');

// Real data from the user's error
const attestationFromUser = {
  id: 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F',
  rawId: 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoieHVTN3hkbDQxczl6bjBVUkp4MnprenJJX3VwakU1N0dqamF3RjFmNW02X2xiRWMtdEVXaWduUXItTVJxR1lwSGFFODBSY252NFhTRlBwQWZVTHhCbGciLCJvcmlnaW4iOiJodHRwczovL3d3dy5jaHJpc3RvcGhlcmRlYmVlci5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9',
    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVi0IPY0oTzaow-pUFFvYO_k52yCk_2anMIMM20rFVgjwg5dAAAAALeKClVu-NJGoEK6D21VBQwAMDimOesfs7dsAdoMgonkIn4ll3a_cDFnlgWhNEs4yE4BN8vtdmQa_uyBGvSOf4U-BaUBAgMmIAEhWCDzxXjygIB-nofJuEYEnXKR8PkE-LP-_UELpsp_oTINfCJYIHRrVATiKhNdadFFRTwbQI8xt7ZfHcsESsgjNnWIHCPQ'
  },
  type: 'public-key'
};

// Helper from lambda
function fromBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;
}

console.log('Testing data format conversions...\n');

// Test 1: What does our code produce?
console.log('=== Current Implementation (from lambda/index.ts) ===');
const convertedAttestation = {
  ...attestationFromUser,
  id: fromBase64Url(attestationFromUser.id),
  rawId: fromBase64Url(attestationFromUser.rawId),
  response: {
    ...attestationFromUser.response,
    clientDataJSON: attestationFromUser.response.clientDataJSON,
    attestationObject: attestationFromUser.response.attestationObject,
  },
};

console.log('id type:', typeof convertedAttestation.id);
console.log('id instanceof ArrayBuffer:', convertedAttestation.id instanceof ArrayBuffer);
console.log('id instanceof Buffer:', Buffer.isBuffer(convertedAttestation.id));

console.log('\nrawId type:', typeof convertedAttestation.rawId);
console.log('rawId instanceof ArrayBuffer:', convertedAttestation.rawId instanceof ArrayBuffer);
console.log('rawId instanceof Buffer:', Buffer.isBuffer(convertedAttestation.rawId));

console.log('\nclientDataJSON type:', typeof convertedAttestation.response.clientDataJSON);
console.log('attestationObject type:', typeof convertedAttestation.response.attestationObject);

// Test 2: Check if id and rawId are the same
console.log('\n=== Checking id vs rawId ===');
const idBuffer = Buffer.from(convertedAttestation.id);
const rawIdBuffer = Buffer.from(convertedAttestation.rawId);
console.log('id Buffer:', idBuffer.toString('base64url'));
console.log('rawId Buffer:', rawIdBuffer.toString('base64url'));
console.log('Are they equal?', idBuffer.equals(rawIdBuffer));
console.log('Match original?', idBuffer.toString('base64url') === attestationFromUser.id);

// Test 3: Check if the issue is with the spread operator
console.log('\n=== Testing spread operator issue ===');
console.log('All keys in convertedAttestation:', Object.keys(convertedAttestation));
console.log('Has type field?', convertedAttestation.type);
console.log('Has id field?', convertedAttestation.id !== undefined);
console.log('Has rawId field?', convertedAttestation.rawId !== undefined);

// Check if there's any hidden property
console.log('\n=== Checking for hidden properties ===');
const descriptors = Object.getOwnPropertyDescriptors(convertedAttestation);
for (const [key, descriptor] of Object.entries(descriptors)) {
  if (key === 'id' || key === 'rawId') {
    console.log(`${key}:`, descriptor.value?.constructor?.name);
  }
}

process.exit(0);