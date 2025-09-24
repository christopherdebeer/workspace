// Example Plugins - Demonstration plugins showing plugin system capabilities
import { CommandPlugin, createPlugin } from './commandPlugin';
import { contextManager } from './commandContext';
import { macroManager, createMacro, createMacroStep } from './commandMacro';
import { templateManager } from './commandTemplates';

// Utils Plugin - Common utility commands
export const utilsPlugin: CommandPlugin = createPlugin({
  id: 'core.utils',
  name: 'Utility Commands',
  description: 'Common utility commands for development',
  version: '1.0.0',
  commands: [
    {
      id: 'utils.timestamp',
      name: 'timestamp',
      description: 'Get current timestamp in various formats',
      category: 'Utils',
      keywords: ['time', 'date', 'timestamp'],
      args: [
        {
          name: 'format',
          type: 'choice',
          choices: ['unix', 'iso', 'human'],
          required: false,
          description: 'Output format (default: human)'
        }
      ],
      handler: async (args: any) => {
        const format = args?.format || 'human';
        const now = new Date();
        
        switch (format) {
          case 'unix':
            return now.getTime().toString();
          case 'iso':
            return now.toISOString();
          case 'human':
          default:
            return now.toLocaleString();
        }
      }
    },
    {
      id: 'utils.uuid',
      name: 'uuid',
      description: 'Generate a random UUID',
      category: 'Utils',
      keywords: ['uuid', 'guid', 'random', 'id'],
      handler: async () => {
        return crypto.randomUUID();
      }
    },
    {
      id: 'utils.base64',
      name: 'base64',
      description: 'Encode or decode base64 strings',
      category: 'Utils',
      keywords: ['base64', 'encode', 'decode'],
      args: [
        {
          name: 'action',
          type: 'choice',
          choices: ['encode', 'decode'],
          required: true,
          description: 'Whether to encode or decode'
        },
        {
          name: 'text',
          type: 'string',
          required: true,
          description: 'Text to encode/decode'
        }
      ],
      handler: async (args: any) => {
        const { action, text } = args;
        
        try {
          if (action === 'encode') {
            return btoa(text);
          } else {
            return atob(text);
          }
        } catch (error) {
          throw new Error(`Base64 ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  ],
  onLoad: async () => {
    console.log('Utils plugin loaded - timestamp, uuid, and base64 commands available');
  }
});

// Context Plugin - Commands that interact with application context
export const contextPlugin: CommandPlugin = createPlugin({
  id: 'core.context',
  name: 'Context Commands',
  description: 'Commands for managing application context and state',
  version: '1.0.0',
  commands: [
    {
      id: 'context.status',
      name: 'context-status',
      description: 'Show current application context and state',
      category: 'Context',
      keywords: ['context', 'state', 'status'],
      handler: async () => {
        const state = contextManager.getState();
        const context = contextManager.getContext();
        
        let result = '=== Application Context ===\n';
        result += `Environment: ${context.environment}\n`;
        result += `Active Module: ${context.activeModule || 'none'}\n`;
        result += `Connection Status: ${state.connectionStatus}\n`;
        result += `Permissions: ${context.permissions?.join(', ') || 'none'}\n`;
        
        if (state.selectedItems) {
          result += `Selected Items: ${state.selectedItems.join(', ')}\n`;
        }
        
        if (state.activeTab) {
          result += `Active Tab: ${state.activeTab}\n`;
        }
        
        return result;
      }
    },
    {
      id: 'context.set-module',
      name: 'set-module',
      description: 'Set the active application module',
      category: 'Context',
      keywords: ['context', 'module', 'set'],
      args: [
        {
          name: 'module',
          type: 'choice',
          choices: ['api', 'database', 'tools', 'settings'],
          required: true,
          description: 'Module to activate'
        }
      ],
      handler: async (args: any) => {
        contextManager.setModule(args.module);
        return `Active module set to: ${args.module}`;
      }
    },
    {
      id: 'context.permissions',
      name: 'permissions',
      description: 'Manage user permissions',
      category: 'Context',
      keywords: ['permissions', 'access', 'security'],
      args: [
        {
          name: 'action',
          type: 'choice',
          choices: ['list', 'add', 'remove'],
          required: true,
          description: 'Action to perform'
        },
        {
          name: 'permission',
          type: 'string',
          required: false,
          description: 'Permission to add/remove (required for add/remove)'
        }
      ],
      handler: async (args: any) => {
        const { action, permission } = args;
        
        switch (action) {
          case 'list':
            const current = contextManager.getState().userPermissions;
            return `Current permissions: ${current.join(', ')}`;
            
          case 'add':
            if (!permission) throw new Error('Permission name required for add action');
            contextManager.addPermission(permission);
            return `Permission '${permission}' added`;
            
          case 'remove':
            if (!permission) throw new Error('Permission name required for remove action');
            contextManager.removePermission(permission);
            return `Permission '${permission}' removed`;
            
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      }
    }
  ],
  onLoad: async () => {
    console.log('Context plugin loaded - context management commands available');
  }
});

// Macro Plugin - Commands for managing and executing macros
export const macroPlugin: CommandPlugin = createPlugin({
  id: 'core.macros',
  name: 'Macro Commands', 
  description: 'Commands for creating and managing command macros',
  version: '1.0.0',
  commands: [
    {
      id: 'macro.list',
      name: 'list-macros',
      description: 'List all registered macros',
      category: 'Macros',
      keywords: ['macro', 'list', 'commands'],
      handler: async () => {
        const macros = macroManager.getMacros();
        
        if (macros.length === 0) {
          return 'No macros registered';
        }
        
        let result = '=== Registered Macros ===\n';
        for (const macro of macros) {
          result += `${macro.name}: ${macro.description} (${macro.steps.length} steps)\n`;
          for (let i = 0; i < macro.steps.length; i++) {
            const step = macro.steps[i];
            result += `  ${i + 1}. ${step.commandId}${step.description ? ' - ' + step.description : ''}\n`;
          }
          result += '\n';
        }
        
        return result;
      }
    },
    {
      id: 'macro.create-example',
      name: 'create-example-macro',
      description: 'Create an example system check macro',
      category: 'Macros',
      keywords: ['macro', 'create', 'example'],
      handler: async () => {
        const exampleMacro = createMacro({
          id: 'example.system-check',
          name: 'system-check',
          description: 'Complete system health check',
          category: 'System',
          keywords: ['system', 'health', 'check'],
          steps: [
            createMacroStep('system.status', {}, {
              description: 'Check system status',
              condition: 'always'
            }),
            createMacroStep('mcp.capabilities', {}, {
              description: 'Check MCP capabilities',
              condition: 'on-success'
            }),
            createMacroStep('mcp.list-tools', {}, {
              description: 'List available tools',
              condition: 'on-success'
            })
          ]
        });
        
        macroManager.registerMacro(exampleMacro);
        return 'Example system-check macro created! Use "system-check" command to run it.';
      }
    }
  ],
  onLoad: async () => {
    console.log('Macro plugin loaded - macro management commands available');
    
    // Create a simple example macro on load
    const quickStatusMacro = createMacro({
      id: 'builtin.quick-status',
      name: 'quick-status',
      description: 'Quick status check with echo',
      category: 'System',
      steps: [
        createMacroStep('system.status', {}, {
          description: 'Get system status'
        }),
        createMacroStep('mcp.echo', { message: 'System check complete' }, {
          description: 'Confirm completion',
          condition: 'on-success'
        })
      ]
    });
    
    macroManager.registerMacro(quickStatusMacro);
  }
});

// Export all example plugins
export const examplePlugins = [utilsPlugin, contextPlugin, macroPlugin];