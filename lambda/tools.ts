export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: string[]

;
  description?: string;
  items?: JsonSchema;
  [key: string]: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  call(args: Record<string, unknown>, username?: string): Promise<ToolResult>;
}

export const tools = new Map<string, Tool>();
