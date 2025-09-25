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
    args: [
      {
        name: 'message',
        type: 'string',
        required: true,
        description: 'Text to echo through the MCP server'
      }
    ],
    handler: async (args: any) => {
      const message = typeof args === 'string' || Array.isArray(args) 
        ? (Array.isArray(args) ? args.join(' ') : args)
        : args.message || '';
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
    args: [
      {
        name: 'params',
        type: 'string',
        required: false,
        description: 'JSON parameters for the DynamoDB operation'
      }
    ],
    handler: async (args: any) => {
      let params = {};
      if (typeof args === 'string') {
        params = args ? JSON.parse(args) : {};
      } else if (Array.isArray(args)) {
        const bodyArgs = args.join(' ');
        params = bodyArgs ? JSON.parse(bodyArgs) : {};
      } else if (args && args.params) {
        params = args.params ? JSON.parse(args.params) : {};
      }
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