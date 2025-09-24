// Default Commands - Core commands with categories and improved structure
import { Command } from './commandRegistry';
import { apiUrl, mcpRequest, callTool } from './mcpClient';

export const createDefaultCommands = (): Command[] => [
  {
    id: 'system.status',
    name: 'status',
    description: 'GET / - Check system status',
    category: 'System',
    keywords: ['health', 'check', 'api'],
    handler: async () => {
      const r = await fetch(apiUrl);
      const data = await r.json();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    id: 'mcp.capabilities',
    name: 'capabilities',
    description: 'POST /mcp capabilities - List MCP server capabilities',
    category: 'MCP',
    keywords: ['mcp', 'server', 'features'],
    handler: async () => {
      const data = await mcpRequest('capabilities');
      return JSON.stringify(data, null, 2);
    },
  },
  {
    id: 'mcp.echo',
    name: 'echo',
    description: 'POST /mcp echo <text> - Echo text through MCP server',
    category: 'MCP',
    keywords: ['test', 'message', 'debug'],
    handler: async (args: string[]) => {
      const message = args.join(' ');
      const data = await mcpRequest('echo', message);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    id: 'mcp.list-tools',
    name: 'list-tools',
    description: 'POST /mcp tools/list - List available MCP tools',
    category: 'MCP',
    keywords: ['tools', 'available', 'list'],
    handler: async () => {
      const data = await mcpRequest('tools/list');
      return JSON.stringify(data, null, 2);
    },
  },
  {
    id: 'tools.call-dynamo',
    name: 'call-dynamo',
    description: 'POST /mcp tools/call dynamodb <json> - Call DynamoDB tool',
    category: 'Tools',
    keywords: ['dynamodb', 'database', 'aws'],
    handler: async (args: string[]) => {
      const bodyArgs = args.join(' ');
      const params = bodyArgs ? JSON.parse(bodyArgs) : {};
      const data = await callTool('dynamodb', params);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    id: 'system.help',
    name: 'help',
    description: 'List all available commands',
    category: 'System',
    keywords: ['commands', 'usage', 'docs'],
    handler: async () => {
      // This will be populated by the registry
      return 'Use the command palette to browse available commands by category.';
    },
  },
];