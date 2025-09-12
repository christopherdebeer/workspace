import { configService } from './config';

let cachedApiUrl: string | null = null;

// Get API URL - this will be initialized when config is loaded
export async function getApiUrl(): Promise<string> {
  if (cachedApiUrl !== null) {
    return cachedApiUrl;
  }
  const config = await configService.getConfig();
  cachedApiUrl = config.apiUrl;
  return config.apiUrl;
}

// Get MCP URL
export async function getMcpUrl(): Promise<string> {
  const apiUrl = await getApiUrl();
  return apiUrl.replace(/\/?$/, '') + '/mcp';
}

// For backward compatibility - this will return empty string initially
export let apiUrl = '';

// Initialize configuration
export async function initializeMcpClient(): Promise<void> {
  apiUrl = await getApiUrl();
}

async function fetchJson(url: string, options: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string };
}

export async function mcpRequest(
  method: string,
  params?: any,
  id: number | string = 1
): Promise<JsonRpcResponse> {
  const mcpUrl = await getMcpUrl();
  return fetchJson(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

export async function callTool(name: string, args?: any) {
  return mcpRequest('tools/call', { name, arguments: args });
}
