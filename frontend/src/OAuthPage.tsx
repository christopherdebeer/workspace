import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { apiUrl } from './mcpClient';
import WebAuthComponent from './WebAuthComponent';

const Container = styled.div`
  max-width: 500px;
  margin: 2rem auto;
  padding: 2rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
`;

const Title = styled.h2`
  margin: 0 0 1rem 0;
  color: #333;
`;

const Info = styled.div`
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 4px;
  margin-bottom: 1.5rem;

  p {
    margin: 0.5rem 0;
  }

  strong {
    color: #007bff;
  }
`;

const Status = styled.div`
  padding: 1rem;
  background: #d1ecf1;
  border: 1px solid #bee5eb;
  border-radius: 4px;
  color: #0c5460;
  margin-top: 1rem;
`;

export default function OAuthPage() {
  const [clientId, setClientId] = useState<string>('');
  const [redirectUri, setRedirectUri] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(params.get('client_id') || '');
    setRedirectUri(params.get('redirect_uri') || '');
    setState(params.get('state') || '');

    const token = localStorage.getItem('authToken');
    const storedUsername = localStorage.getItem('authUsername');
    if (token && storedUsername) {
      setIsAuthenticated(true);
      setUsername(storedUsername);
      handleAuthorization(storedUsername, token, params);
    }
  }, []);

  const handleAuthorization = async (user: string, token: string, params: URLSearchParams) => {
    const client = params.get('client_id') || clientId;
    const redirect = params.get('redirect_uri') || redirectUri;
    const st = params.get('state') || state;

    const authUrl = new URL(`${apiUrl}/oauth/authorize`);
    authUrl.searchParams.set('client_id', client);
    authUrl.searchParams.set('redirect_uri', redirect);
    authUrl.searchParams.set('username', user);
    authUrl.searchParams.set('token', token);
    if (st) authUrl.searchParams.set('state', st);

    window.location.href = authUrl.toString();
  };

  const handleAuthSuccess = () => {
    const token = localStorage.getItem('authToken');
    const storedUsername = localStorage.getItem('authUsername');
    if (token && storedUsername) {
      setIsAuthenticated(true);
      setUsername(storedUsername);
      handleAuthorization(storedUsername, token, new URLSearchParams(window.location.search));
    }
  };

  if (!clientId || !redirectUri) {
    return (
      <Container>
        <Title>OAuth Authorization Error</Title>
        <p>Missing required parameters: client_id and redirect_uri</p>
      </Container>
    );
  }

  return (
    <Container>
      <Title>MCP Server Authorization</Title>
      <Info>
        <p><strong>Application:</strong> {clientId}</p>
        <p><strong>Redirect URI:</strong> {redirectUri}</p>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          This application is requesting access to your MCP server.
        </p>
      </Info>

      {!isAuthenticated ? (
        <>
          <p>Please authenticate to authorize this application:</p>
          <WebAuthComponent onAuthSuccess={handleAuthSuccess} />
        </>
      ) : (
        <Status>
          Authenticated as {username}. Redirecting...
        </Status>
      )}
    </Container>
  );
}