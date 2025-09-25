// Command History - Track and manage command execution history
export interface HistoryEntry {
  id: string;
  commandName: string;
  args: string[];
  timestamp: Date;
  result?: string;
  error?: string;
}

export class CommandHistory {
  private history: HistoryEntry[] = [];
  private maxHistory: number = 50;

  addEntry(commandName: string, args: string[], result?: string, error?: string): void {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      commandName,
      args,
      timestamp: new Date(),
      result,
      error
    };

    this.history.unshift(entry); // Add to beginning

    // Keep only the most recent entries
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }

    // Persist to localStorage
    this.saveToStorage();
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  getRecentCommands(limit: number = 10): string[] {
    const recent = new Set<string>();
    
    for (const entry of this.history) {
      if (recent.size >= limit) break;
      const fullCommand = entry.args.length > 0 
        ? `${entry.commandName} ${entry.args.join(' ')}`
        : entry.commandName;
      recent.add(fullCommand);
    }
    
    return Array.from(recent);
  }

  getCommandUsageCount(commandName: string): number {
    return this.history.filter(entry => entry.commandName === commandName).length;
  }

  getMostUsedCommands(limit: number = 5): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    
    for (const entry of this.history) {
      const current = counts.get(entry.commandName) || 0;
      counts.set(entry.commandName, current + 1);
    }
    
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  clear(): void {
    this.history = [];
    this.saveToStorage();
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem('commandHistory', JSON.stringify(this.history));
    } catch (e) {
      // localStorage might not be available
      console.warn('Could not save command history to localStorage:', e);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('commandHistory');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        this.history = parsed.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp)
        }));
      }
    } catch (e) {
      console.warn('Could not load command history from localStorage:', e);
      this.history = [];
    }
  }

  constructor() {
    this.loadFromStorage();
  }
}

// Global history instance
export const commandHistory = new CommandHistory();