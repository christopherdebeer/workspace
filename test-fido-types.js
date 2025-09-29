// Simple test to see what fido2-lib expects
const { Fido2Lib } = require('fido2-lib');

console.log('Creating Fido2Lib instance...');
const fido = new Fido2Lib({
  rpId: 'www.christopherdebeer.com',
  rpName: 'Workspace',
  challengeSize: 64
});

console.log('Fido2Lib created successfully');
console.log('Fido2Lib constructor:', fido.constructor.name);

// Let's check what the library expects by looking at its methods
console.log('\nAvailable methods:');
console.log('- attestationOptions:', typeof fido.attestationOptions);
console.log('- attestationResult:', typeof fido.attestationResult);
console.log('- assertionOptions:', typeof fido.assertionOptions);
console.log('- assertionResult:', typeof fido.assertionResult);

// Try to get some options to see what format it uses
fido.attestationOptions().then(opts => {
  console.log('\nAttestation options challenge type:', typeof opts.challenge);
  console.log('Challenge instanceof ArrayBuffer:', opts.challenge instanceof ArrayBuffer);
  console.log('Challenge instanceof Buffer:', Buffer.isBuffer(opts.challenge));
  console.log('Challenge constructor:', opts.challenge?.constructor?.name);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});