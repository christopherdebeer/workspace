const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());

const mockDb = new Map();

function logServer(message, data) {
  console.log(`[SERVER] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function getMockDynamoClient() {
  return {
    get: async ({ TableName, Key }) => {
      const id = Key.id;
      const item = mockDb.get(id);
      logServer(`DynamoDB GET ${id}`, item);
      return { Item: item };
    },
    put: async ({ TableName, Item }) => {
      mockDb.set(Item.id, Item);
      logServer(`DynamoDB PUT ${Item.id}`, Item);
      return {};
    },
    promise: function() { return this; }
  };
}

process.env.TABLE_NAME = 'test-table';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  if (!args[0]?.includes('[SERVER]') && !args[0]?.includes('[CLIENT]')) {
    originalConsoleLog('[SERVER]', ...args);
  } else {
    originalConsoleLog(...args);
  }
};

console.error = (...args) => {
  originalConsoleError('[SERVER ERROR]', ...args);
};

let lambdaHandler;

const jsPath = path.join(__dirname, 'dist', 'lambda', 'index.js');
if (!fs.existsSync(jsPath)) {
  logServer('Compiled Lambda not found, compiling TypeScript...');
  const { execSync } = require('child_process');
  try {
    execSync('tsc', { stdio: 'inherit' });
  } catch (buildError) {
    logServer('Failed to compile TypeScript:', buildError);
    process.exit(1);
  }
}

try {
  const lambdaModule = require('./dist/lambda/index.js');
  lambdaHandler = lambdaModule.handler;
  logServer('Lambda handler loaded successfully');
} catch (error) {
  logServer('Failed to load Lambda handler:', error);
  process.exit(1);
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

app.all(LAMBDA_PATHS, async (req, res) => {
  try {
    const event = {
      rawPath: req.path,
      path: req.path,
      httpMethod: req.method,
      requestContext: { http: { method: req.method } },
      headers: req.headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    };

    const result = await lambdaHandler(event);

    logServer(`Lambda response ${result.statusCode}`, { body: result.body });

    res.status(result.statusCode);
    if (result.headers) {
      Object.entries(result.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }
    res.send(result.body);
  } catch (error) {
    logServer('Lambda error:', error);
    res.status(500).json({ error: error.message });
  }
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