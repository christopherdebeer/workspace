const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());

function logServer(message, data) {
  console.log(`[SERVER] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function generateMockChallenge() {
  return Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString('base64');
}

function getMockMcpResponse(method) {
  switch (method) {
    case 'capabilities':
      return {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: {},
          resources: {},
          prompts: {}
        }
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: []
        }
      };
    default:
      return {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      };
  }
}

function getMockWebAuthnRegisterOptions(username) {
  return {
    challenge: generateMockChallenge(),
    rp: {
      name: 'Workspace',
      id: 'localhost'
    },
    user: {
      id: Buffer.from(username).toString('base64'),
      name: username,
      displayName: username
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 }
    ],
    timeout: 60000,
    attestation: 'none'
  };
}

function getMockWebAuthnLoginOptions(username) {
  return {
    challenge: generateMockChallenge(),
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials: [
      {
        type: 'public-key',
        id: Buffer.from('mock-credential-id-' + username).toString('base64')
      }
    ]
  };
}

const LAMBDA_PATHS = ['/mcp', '/webauthn/register/options', '/webauthn/register/verify', '/webauthn/login/options', '/webauthn/login/verify'];

app.use((req, res, next) => {
  if (LAMBDA_PATHS.some(p => req.path.startsWith(p))) {
    logServer(`${req.method} ${req.path}`, { headers: req.headers, body: req.body });
    next();
  } else {
    next();
  }
});

app.post('/mcp', (req, res) => {
  const { method } = req.body;
  logServer('MCP request', { method });
  const response = getMockMcpResponse(method);
  res.json(response);
});

app.post('/webauthn/register/options', (req, res) => {
  const { username } = req.body;
  logServer('WebAuthn register options', { username });
  res.json(getMockWebAuthnRegisterOptions(username));
});

app.post('/webauthn/register/verify', (req, res) => {
  logServer('WebAuthn register verify');
  res.json({ success: true, message: 'Mock registration successful' });
});

app.post('/webauthn/login/options', (req, res) => {
  const { username } = req.body;
  logServer('WebAuthn login options', { username });
  res.json(getMockWebAuthnLoginOptions(username));
});

app.post('/webauthn/login/verify', (req, res) => {
  logServer('WebAuthn login verify');
  res.json({ success: true, message: 'Mock login successful' });
});

const distPath = path.join(__dirname, 'frontend', 'dist');
if (!fs.existsSync(distPath)) {
  logServer('Frontend dist not found, building...');
  const { execSync } = require('child_process');
  try {
    execSync('npm run build:web', { stdio: 'inherit' });
  } catch (error) {
    logServer('Failed to build frontend:', error);
    process.exit(1);
  }
}

app.use('/workspace', express.static(distPath));

app.get('/', (req, res) => {
  res.redirect('/workspace/');
});

app.use((req, res, next) => {
  if (!LAMBDA_PATHS.some(p => req.path.startsWith(p))) {
    logServer(`Static file request: ${req.path}`);
  }
  next();
});

const server = app.listen(PORT, () => {
  logServer(`Test server running on http://localhost:${PORT}`);
  logServer(`Frontend: http://localhost:${PORT}/workspace/`);
  logServer(`Lambda endpoints: ${LAMBDA_PATHS.join(', ')}`);
});

process.on('SIGTERM', () => {
  logServer('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logServer('Server closed');
    process.exit(0);
  });
});

module.exports = server;