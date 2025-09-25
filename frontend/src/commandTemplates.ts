// Command Templates - Pre-configured command patterns and templates
import { Command, ArgumentSchema } from './commandRegistry';
import { CommandMacro, createMacro, createMacroStep } from './commandMacro';

export interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  pattern: string; // Template with placeholders like {{param}}
  args: ArgumentSchema[];
  example?: string;
  keywords?: string[];
}

export class CommandTemplateManager {
  private templates = new Map<string, CommandTemplate>();

  registerTemplate(template: CommandTemplate): void {
    this.templates.set(template.id, template);
  }

  unregisterTemplate(templateId: string): void {
    this.templates.delete(templateId);
  }

  getTemplate(templateId: string): CommandTemplate | undefined {
    return this.templates.get(templateId);
  }

  getTemplates(): CommandTemplate[] {
    return Array.from(this.templates.values());
  }

  getTemplatesByCategory(category: string): CommandTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  renderTemplate(templateId: string, params: Record<string, any>): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    let result = template.pattern;
    
    // Replace placeholders with actual values
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), String(value));
    }

    // Check for unreplaced placeholders
    const unreplaced = result.match(/{{[^}]+}}/g);
    if (unreplaced) {
      throw new Error(`Missing parameters: ${unreplaced.join(', ')}`);
    }

    return result;
  }

  searchTemplates(query: string): CommandTemplate[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.templates.values()).filter(template => 
      template.name.toLowerCase().includes(queryLower) ||
      template.description.toLowerCase().includes(queryLower) ||
      template.category.toLowerCase().includes(queryLower) ||
      template.keywords?.some(keyword => keyword.toLowerCase().includes(queryLower))
    );
  }
}

// Global template manager
export const templateManager = new CommandTemplateManager();

// Default templates
export const registerDefaultTemplates = () => {
  // API Testing Templates
  templateManager.registerTemplate({
    id: 'api.test-endpoint',
    name: 'test-endpoint',
    description: 'Test API endpoint with status check',
    category: 'API Testing',
    pattern: 'status && echo "Testing {{endpoint}}" && {{command}}',
    args: [
      {
        name: 'endpoint',
        type: 'string',
        required: true,
        description: 'API endpoint to test'
      },
      {
        name: 'command',
        type: 'string', 
        required: true,
        description: 'Command to run for testing'
      }
    ],
    example: 'test-endpoint endpoint="/api/users" command="list-tools"',
    keywords: ['api', 'test', 'endpoint', 'status']
  });

  // Database Templates
  templateManager.registerTemplate({
    id: 'db.query-with-status',
    name: 'db-query',
    description: 'Execute database query with connection status check',
    category: 'Database',
    pattern: 'status && call-dynamo {{params}}',
    args: [
      {
        name: 'params',
        type: 'string',
        required: true,
        description: 'JSON parameters for DynamoDB query'
      }
    ],
    example: 'db-query params=\'{"TableName": "users", "Key": {"id": "123"}}\'',
    keywords: ['database', 'dynamo', 'query', 'db']
  });

  // Development Workflow Templates
  templateManager.registerTemplate({
    id: 'dev.full-check',
    name: 'full-check',
    description: 'Complete system check: status, capabilities, and tools',
    category: 'Development',
    pattern: 'status && capabilities && list-tools',
    args: [],
    example: 'full-check',
    keywords: ['development', 'check', 'system', 'status']
  });

  // Debug Templates
  templateManager.registerTemplate({
    id: 'debug.echo-test',
    name: 'echo-test',
    description: 'Debug with echo message and system info',
    category: 'Debug',
    pattern: 'echo "{{message}}" && status',
    args: [
      {
        name: 'message',
        type: 'string',
        required: true,
        description: 'Debug message to echo'
      }
    ],
    example: 'echo-test message="Testing connection"',
    keywords: ['debug', 'echo', 'test', 'message']
  });
};

// Macro templates - convert templates to macros
export const createMacroFromTemplate = (templateId: string, params: Record<string, any>): CommandMacro => {
  const template = templateManager.getTemplate(templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const renderedPattern = templateManager.renderTemplate(templateId, params);
  const commands = renderedPattern.split(' && ').map(cmd => cmd.trim());

  return createMacro({
    id: `template.${templateId}.${Date.now()}`,
    name: `${template.name}-${Object.values(params).join('-')}`,
    description: `Generated from template: ${template.description}`,
    category: template.category,
    keywords: template.keywords,
    steps: commands.map((command, index) => {
      const [commandName, ...args] = command.split(' ');
      return createMacroStep(
        commandName,
        args.length > 0 ? { args: args.join(' ') } : undefined,
        {
          condition: index === 0 ? 'always' : 'on-success',
          description: `Step ${index + 1}: ${command}`
        }
      );
    })
  });
};

// Template-based command generator
export const generateCommandFromTemplate = (template: CommandTemplate): Command => {
  return {
    id: `template.${template.id}`,
    name: template.name,
    description: `${template.description} (template)`,
    category: template.category,
    keywords: [...(template.keywords || []), 'template'],
    args: template.args,
    handler: async (args: any) => {
      try {
        const macro = createMacroFromTemplate(template.id, args);
        // This would execute the macro, but for now just return the pattern
        return `Template rendered: ${templateManager.renderTemplate(template.id, args)}`;
      } catch (error) {
        throw new Error(`Template execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
};