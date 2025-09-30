const apiUrl = (import.meta.env.VITE_FUNCTION_URL as string | undefined) ?? '';
export const mcpUrl = apiUrl.replace(/\/?$/, '') + '/mcp';

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
  result?: unknown;
  error?: { code: number; message: string };
}

export async function mcpRequest(
  method: string,
  params?: unknown,
  id: number | string = 1
): Promise<JsonRpcResponse> {
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Include bearer token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetchJson(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

export async function callTool(name: string, args?: unknown) {
  return mcpRequest('tools/call', { name, arguments: args });
}

export { apiUrl };
