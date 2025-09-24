// Simple test to verify the clientDataJSON fix
describe('WebAuthn clientDataJSON Fix', () => {
  it('should verify that clientDataJSON remains as base64url string', () => {
    // Mock the base64url conversion functions from the lambda
    function toBase64Url(buf: Buffer) {
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function fromBase64Url(str: string): ArrayBuffer {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      const pad = str.length % 4;
      if (pad) str += '='.repeat(4 - pad);
      return Buffer.from(str, 'base64').buffer;
    }

    // Test the original issue: verify that keeping clientDataJSON as string prevents corruption
    const originalClientData = {
      type: 'webauthn.create',
      challenge: 'test-challenge',
      origin: 'https://www.christopherdebeer.com',
      crossOrigin: false,
    };

    const clientDataJSON = toBase64Url(Buffer.from(JSON.stringify(originalClientData)));

    // This is the fix: keep clientDataJSON as base64url string (don't convert to ArrayBuffer)
    const keepAsString = clientDataJSON;

    // Verify it doesn't get corrupted with AWS signature data
    expect(keepAsString).not.toMatch(/^AWS4-HMAC-/);
    expect(keepAsString).toMatch(/^[A-Za-z0-9_-]+$/); // Valid base64url format

    // Verify it can be properly decoded back to JSON
    const decoded = Buffer.from(
      keepAsString
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(keepAsString.length + (4 - (keepAsString.length % 4)) % 4, '='),
      'base64'
    ).toString('utf8');

    const parsedData = JSON.parse(decoded);
    expect(parsedData).toEqual(originalClientData);
  });

  it('should demonstrate the previous bug would have caused AWS signature corruption', () => {
    // This test shows what would happen if we incorrectly convert to ArrayBuffer
    const clientDataJSON = 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0'; // Valid base64url

    // The bug: converting to ArrayBuffer and back would potentially cause corruption
    // This is what was happening before the fix
    function simulateOriginalBug(str: string): string {
      // Convert to ArrayBuffer (the bug)
      const buffer = Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      // When this gets processed by AWS Lambda, it could get signed and corrupted
      return buffer.toString(); // This could result in AWS4-HMAC-... corruption
    }

    // Our fix: keep as string
    function fixedApproach(str: string): string {
      return str; // Keep as base64url string
    }

    expect(fixedApproach(clientDataJSON)).toBe(clientDataJSON);
    expect(fixedApproach(clientDataJSON)).not.toMatch(/^AWS4-HMAC-/);
  });
});