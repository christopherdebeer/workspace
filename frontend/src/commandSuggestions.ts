// Command Suggestions - Generate command suggestions based on context and usage
import { Command } from './commandRegistry';
import { commandHistory } from './commandHistory';

export interface SuggestionReason {
  type: 'related' | 'frequent' | 'recent' | 'category';
  reason: string;
}

export interface CommandSuggestion {
  command: Command;
  reason: SuggestionReason;
  score: number;
}

export class CommandSuggestionEngine {
  generateSuggestions(
    lastExecutedCommand: Command, 
    allCommands: Command[], 
    limit: number = 3
  ): CommandSuggestion[] {
    const suggestions: CommandSuggestion[] = [];

    // Related commands (same category)
    const relatedCommands = allCommands.filter(cmd => 
      cmd.category === lastExecutedCommand.category && 
      cmd.id !== lastExecutedCommand.id
    );

    for (const cmd of relatedCommands) {
      suggestions.push({
        command: cmd,
        reason: {
          type: 'category',
          reason: `Similar to ${lastExecutedCommand.name} (${cmd.category})`
        },
        score: 0.7
      });
    }

    // Frequently used commands
    const mostUsed = commandHistory.getMostUsedCommands(5);
    for (const { name, count } of mostUsed) {
      const cmd = allCommands.find(c => c.name === name);
      if (cmd && cmd.id !== lastExecutedCommand.id) {
        suggestions.push({
          command: cmd,
          reason: {
            type: 'frequent',
            reason: `Frequently used (${count} times)`
          },
          score: 0.6 + (count * 0.1)
        });
      }
    }

    // Recently used commands
    const recent = commandHistory.getRecentCommands(5);
    for (let i = 0; i < recent.length; i++) {
      const recentCommandName = recent[i].split(' ')[0]; // Get command name without args
      const cmd = allCommands.find(c => c.name === recentCommandName);
      if (cmd && cmd.id !== lastExecutedCommand.id) {
        suggestions.push({
          command: cmd,
          reason: {
            type: 'recent',
            reason: `Recently used`
          },
          score: 0.5 + ((5 - i) * 0.1) // More recent = higher score
        });
      }
    }

    // Command-specific relationships
    const specific = this.getSpecificSuggestions(lastExecutedCommand, allCommands);
    suggestions.push(...specific);

    // Sort by score and remove duplicates
    const uniqueSuggestions = new Map<string, CommandSuggestion>();
    for (const suggestion of suggestions) {
      const existing = uniqueSuggestions.get(suggestion.command.id);
      if (!existing || existing.score < suggestion.score) {
        uniqueSuggestions.set(suggestion.command.id, suggestion);
      }
    }

    return Array.from(uniqueSuggestions.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private getSpecificSuggestions(lastCommand: Command, allCommands: Command[]): CommandSuggestion[] {
    const suggestions: CommandSuggestion[] = [];

    // Define command relationships
    const relationships: Record<string, string[]> = {
      'system.status': ['mcp.capabilities', 'mcp.list-tools'],
      'mcp.capabilities': ['mcp.list-tools', 'mcp.echo'],
      'mcp.list-tools': ['tools.call-dynamo', 'mcp.echo'],
      'tools.call-dynamo': ['mcp.list-tools', 'system.status'],
      'mcp.echo': ['mcp.capabilities', 'system.help']
    };

    const related = relationships[lastCommand.id];
    if (related) {
      for (const commandId of related) {
        const cmd = allCommands.find(c => c.id === commandId);
        if (cmd) {
          suggestions.push({
            command: cmd,
            reason: {
              type: 'related',
              reason: `Works well with ${lastCommand.name}`
            },
            score: 0.8
          });
        }
      }
    }

    return suggestions;
  }
}

export const suggestionEngine = new CommandSuggestionEngine();