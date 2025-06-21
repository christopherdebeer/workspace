export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export class McpClient {
  private url: string;
  private id = 1;
  private capabilities: any | null = null;

  constructor(url: string) {
    this.url = url.replace(/\/?$/, '') + '/mcp';
  }

  async request(method: string, params?: any): Promise<JsonRpcResponse> {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.id++,
      method,
      params,
    };

    const r = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return r.json();
  }

  async negotiateCapabilities() {
    if (!this.capabilities) {
      const res = await this.request('capabilities');
      this.capabilities = res.result;
    }
    return this.capabilities;
  }

  async listTools() {
    await this.negotiateCapabilities();
    const res = await this.request('tools/list');
    return res.result?.tools ?? [];
  }

  async callTool(name: string, args: any) {
    await this.negotiateCapabilities();
    const res = await this.request('tools/call', { name, arguments: args });
    return res.result;
  }
}
