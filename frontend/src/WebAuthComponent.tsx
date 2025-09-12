import { useState } from 'react';
import styled from 'styled-components';
import { apiUrl } from './mcpClient';

const Container = styled.div`
  padding: 1rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
`;

const Input = styled.input`
  width: 100%;
  padding: 0.5rem;
  margin: 0.5rem 0;
  border: 1px solid #ccc;
  border-radius: 4px;
`;

const Button = styled.button`
  padding: 0.5rem 1rem;
  margin: 0.5rem 0.5rem 0.5rem 0;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: #0056b3;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const Status = styled.pre`
  background: #f8f9fa;
  padding: 0.5rem;
  border-radius: 4px;
  margin: 0.5rem 0;
  white-space: pre-wrap;
  font-size: 0.8rem;
`;

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBuffer(base64Url: string): ArrayBuffer {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export default function WebAuthComponent() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const register = async () => {
    if (!username) {
      setStatus('Please enter a username');
      return;
    }

    setIsLoading(true);
    try {
      setStatus('Starting registration...');

      // Get registration options
      const optionsRes = await fetch(`${apiUrl}/webauthn/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!optionsRes.ok) {
        throw new Error(`Failed to get options: ${optionsRes.status}`);
      }

      const options = await optionsRes.json();
      setStatus('Got registration options, creating credential...');

      // Convert challenge and user ID
      const credentialOptions = {
        ...options,
        challenge: base64UrlToBuffer(options.challenge),
        user: {
          ...options.user,
          id: base64UrlToBuffer(options.user.id),
        },
      };

      // Create credential
      const credential = await navigator.credentials.create({
        publicKey: credentialOptions,
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      setStatus('Credential created, verifying...');

      // Prepare attestation response
      const response = credential.response as AuthenticatorAttestationResponse;
      const attestation = {
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        response: {
          clientDataJSON: bufferToBase64Url(response.clientDataJSON),
          attestationObject: bufferToBase64Url(response.attestationObject),
        },
        type: credential.type,
      };

      // Verify registration
      const verifyRes = await fetch(`${apiUrl}/webauthn/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, attestation }),
      });

      if (!verifyRes.ok) {
        throw new Error(`Registration failed: ${verifyRes.status}`);
      }

      setStatus('✅ Registration successful!');
    } catch (error) {
      setStatus(`❌ Registration failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    if (!username) {
      setStatus('Please enter a username');
      return;
    }

    setIsLoading(true);
    try {
      setStatus('Starting login...');

      // Get login options
      const optionsRes = await fetch(`${apiUrl}/webauthn/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!optionsRes.ok) {
        throw new Error(`Failed to get login options: ${optionsRes.status}`);
      }

      const options = await optionsRes.json();
      setStatus('Got login options, authenticating...');

      // Convert challenge and allowCredentials
      const credentialOptions = {
        ...options,
        challenge: base64UrlToBuffer(options.challenge),
        allowCredentials: options.allowCredentials?.map((cred: any) => ({
          ...cred,
          id: base64UrlToBuffer(cred.id),
        })),
      };

      // Get assertion
      const assertion = await navigator.credentials.get({
        publicKey: credentialOptions,
      }) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('Failed to get assertion');
      }

      setStatus('Got assertion, verifying...');

      // Prepare assertion response
      const response = assertion.response as AuthenticatorAssertionResponse;
      const assertionData = {
        id: assertion.id,
        rawId: bufferToBase64Url(assertion.rawId),
        response: {
          clientDataJSON: bufferToBase64Url(response.clientDataJSON),
          authenticatorData: bufferToBase64Url(response.authenticatorData),
          signature: bufferToBase64Url(response.signature),
          userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
        },
        type: assertion.type,
      };

      // Verify login
      const verifyRes = await fetch(`${apiUrl}/webauthn/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, assertion: assertionData }),
      });

      if (!verifyRes.ok) {
        throw new Error(`Login failed: ${verifyRes.status}`);
      }

      setStatus('✅ Login successful!');
    } catch (error) {
      setStatus(`❌ Login failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container>
      <h3>WebAuthn Authentication</h3>
      <div>
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isLoading}
        />
        <div>
          <Button onClick={register} disabled={isLoading}>
            Register
          </Button>
          <Button onClick={login} disabled={isLoading}>
            Login
          </Button>
        </div>
      </div>
      {status && <Status>{status}</Status>}
    </Container>
  );
}