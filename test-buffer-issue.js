// Test to understand the Buffer vs ArrayBuffer issue
const str = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';

console.log('Testing Buffer.from().buffer issue:\n');

// Current implementation (WRONG)
function fromBase64UrlWrong(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64').buffer;  // <-- THIS IS THE BUG!
}

// Correct implementation
function fromBase64UrlCorrect(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  const buffer = Buffer.from(str, 'base64');
  // Create a NEW ArrayBuffer with the exact size
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const wrong = fromBase64UrlWrong(str);
const correct = fromBase64UrlCorrect(str);

console.log('WRONG implementation:');
console.log('  ArrayBuffer byteLength:', wrong.byteLength);
console.log('  First 50 bytes:', Buffer.from(wrong).slice(0, 50).toString('hex'));
console.log('  Converted back to base64url:', Buffer.from(wrong).toString('base64url'));

console.log('\nCORRECT implementation:');
console.log('  ArrayBuffer byteLength:', correct.byteLength);
console.log('  First 50 bytes:', Buffer.from(correct).slice(0, 50).toString('hex'));
console.log('  Converted back to base64url:', Buffer.from(correct).toString('base64url'));

console.log('\nOriginal:', str);
console.log('Match?', Buffer.from(correct).toString('base64url') === str);

console.log('\n=== Why this happens ===');
console.log('Node.js Buffer objects use a pool of ArrayBuffers for efficiency.');
console.log('When you access buffer.buffer, you get the ENTIRE pool ArrayBuffer,');
console.log('not just the slice that contains your data.');
console.log('This causes the "id and credId were not the same" error in fido2-lib!');