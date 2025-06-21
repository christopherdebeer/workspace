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
  result?: any;
  error?: { code: number; message: string };
}

export async function mcpRequest(
  method: string,
  params?: any,
  id: number | string = 1
): Promise<JsonRpcResponse> {
  return fetchJson(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

export async function callTool(name: string, args?: any) {
  return mcpRequest('tools/call', { name, arguments: args });
}

export { apiUrl };
