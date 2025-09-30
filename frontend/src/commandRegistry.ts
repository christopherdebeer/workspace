// Command Registry - Centralized command management system
export interface ArgumentSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'choice';
  required?: boolean;
  choices?: string[];
  description?: string;
}

export interface CommandContext {
  state?: Record<string, unknown>;
  permissions?: string[];
  environment?: 'development' | 'production';
  activeModule?: string;
}

export interface ParsedArgs {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Command {
  id: string;
  name: string;
  description: string;
  category?: string;
  keywords?: string[];
  args?: ArgumentSchema[];
  context?: CommandContext;
  handler: (args: ParsedArgs) => Promise<string>;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private categories = new Set<string>();
  private version = 0;

  register(command: Command): void {
    this.commands.set(command.id, command);
    if (command.category) {
      this.categories.add(command.category);
    }
    this.version++;
  }

  unregister(id: string): void {
    const command = this.commands.get(id);
    if (command) {
      this.commands.delete(id);
      this.version++;
      // Note: We don't remove categories as other commands might use them
    }
  }

  getCommands(context?: CommandContext): Command[] {
    const allCommands = Array.from(this.commands.values());
    
    if (!context) {
      return allCommands;
    }

    // Filter commands based on context
    return allCommands.filter(command => {
      if (!command.context) return true;
      
      // Check module context
      if (command.context.activeModule && context.activeModule !== command.context.activeModule) {
        return false;
      }

      // Check permissions
      if (command.context.permissions && context.permissions) {
        const hasPermission = command.context.permissions.some(permission => 
          context.permissions!.includes(permission)
        );
        if (!hasPermission) return false;
      }

      // Check environment
      if (command.context.environment && context.environment !== command.context.environment) {
        return false;
      }

      return true;
    });
  }

  getCategories(): string[] {
    return Array.from(this.categories).sort();
  }

  getCommand(id: string): Command | undefined {
    return this.commands.get(id);
  }

  getVersion(): number {
    return this.version;
  }

  searchCommands(query: string, context?: CommandContext): Command[] {
    const availableCommands = this.getCommands(context);
    
    if (!query.trim()) {
      return availableCommands;
    }

    const queryLower = query.toLowerCase();
    
    return availableCommands.filter(command => {
      // Search in name
      if (command.name.toLowerCase().includes(queryLower)) return true;
      
      // Search in description
      if (command.description.toLowerCase().includes(queryLower)) return true;
      
      // Search in keywords
      if (command.keywords?.some(keyword => keyword.toLowerCase().includes(queryLower))) {
        return true;
      }
      
      // Search in category
      if (command.category?.toLowerCase().includes(queryLower)) return true;
      
      return false;
    });
  }
}

// Global registry instance
export const commandRegistry = new CommandRegistry();