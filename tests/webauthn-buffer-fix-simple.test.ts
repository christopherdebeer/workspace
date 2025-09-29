// Test for the Buffer.from().buffer pooling issue fix
describe('WebAuthn ArrayBuffer Conversion Fix', () => {
  // Reproduce the fromBase64Url function from lambda/index.ts
  function fromBase64Url(str: string): ArrayBuffer {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    const buffer = Buffer.from(str, 'base64');
    // CRITICAL FIX: buffer.buffer returns the ENTIRE pooled ArrayBuffer (8192 bytes),
    // but we only want the slice that contains our data.
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  function toBase64Url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  it('should return correct ArrayBuffer size, not the entire buffer pool', () => {
    // Real credential ID from user's error
    const credentialId = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';

    const arrayBuffer = fromBase64Url(credentialId);

    // The ArrayBuffer should be exactly 48 bytes, not 8192 bytes (the pool size)
    expect(arrayBuffer.byteLength).toBe(48);
    expect(arrayBuffer.byteLength).not.toBe(8192);
  });

  it('should convert back to the same base64url string', () => {
    const credentialId = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';

    const arrayBuffer = fromBase64Url(credentialId);
    const converted = toBase64Url(Buffer.from(arrayBuffer));

    expect(converted).toBe(credentialId);
  });

  it('should produce identical ArrayBuffers for id and rawId', () => {
    // In WebAuthn, id and rawId are the same value, just in different formats
    const id = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';
    const rawId = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';

    const idBuffer = fromBase64Url(id);
    const rawIdBuffer = fromBase64Url(rawId);

    // They should be identical
    expect(Buffer.from(idBuffer).equals(Buffer.from(rawIdBuffer))).toBe(true);

    // And both should convert back to the original string
    expect(toBase64Url(Buffer.from(idBuffer))).toBe(id);
    expect(toBase64Url(Buffer.from(rawIdBuffer))).toBe(rawId);
  });

  it('should not contain HTTP error messages or garbage data', () => {
    const credentialId = 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F';

    const arrayBuffer = fromBase64Url(credentialId);
    const str = Buffer.from(arrayBuffer).toString('utf8');

    // Should not contain HTTP error messages that would be in the buffer pool
    expect(str).not.toContain('HTTP/1.1');
    expect(str).not.toContain('Bad Request');
    expect(str).not.toContain('Request Timeout');
  });

  it('should work with real attestation data from production error', () => {
    // Real data from the user's production error
    const attestation = {
      id: 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F',
      rawId: 'OKY56x-zt2wB2gyCieQifiWXdr9wMWeWBaE0SzjITgE3y-12ZBr-7IEa9I5_hT4F',
    };

    const idArrayBuffer = fromBase64Url(attestation.id);
    const rawIdArrayBuffer = fromBase64Url(attestation.rawId);

    // Both should be 48 bytes
    expect(idArrayBuffer.byteLength).toBe(48);
    expect(rawIdArrayBuffer.byteLength).toBe(48);

    // Both should be identical
    const idBuffer = Buffer.from(idArrayBuffer);
    const rawIdBuffer = Buffer.from(rawIdArrayBuffer);
    expect(idBuffer.equals(rawIdBuffer)).toBe(true);

    // This should resolve the "id and credId were not the same" error
    // because now fido2-lib will receive the correct 48-byte ArrayBuffer
    // instead of the 8192-byte pool containing garbage data
  });
});