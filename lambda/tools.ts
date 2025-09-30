export interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema: any;
  call(args: any, username?: string): Promise<any>;
}

export const tools = new Map<string, Tool>();
