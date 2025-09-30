// Command Context - Manage application state and contextual command availability
import { CommandContext } from './commandRegistry';

export interface AppState {
  currentModule?: string;
  userPermissions: string[];
  environment: 'development' | 'production';
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastApiResponse?: unknown;
  selectedItems?: string[];
  activeTab?: string;
  [key: string]: unknown;
}

export class CommandContextManager {
  private state: AppState = {
    userPermissions: ['read', 'write'], // Default permissions
    environment: process.env.NODE_ENV as 'development' | 'production' || 'development',
    connectionStatus: 'disconnected'
  };

  private listeners = new Set<(context: CommandContext) => void>();

  setState(updates: Partial<AppState>): void {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...updates };
    
    // Notify listeners if context changed
    const oldContext = this.createContext(oldState);
    const newContext = this.createContext(this.state);
    
    if (this.hasContextChanged(oldContext, newContext)) {
      this.notifyListeners(newContext);
    }
  }

  getState(): AppState {
    return { ...this.state };
  }

  getContext(): CommandContext {
    return this.createContext(this.state);
  }

  onContextChange(listener: (context: CommandContext) => void): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Specific state management methods
  setModule(module: string): void {
    this.setState({ currentModule: module });
  }

  setConnectionStatus(status: AppState['connectionStatus']): void {
    this.setState({ connectionStatus: status });
  }

  setPermissions(permissions: string[]): void {
    this.setState({ userPermissions: permissions });
  }

  addPermission(permission: string): void {
    if (!this.state.userPermissions.includes(permission)) {
      this.setState({
        userPermissions: [...this.state.userPermissions, permission]
      });
    }
  }

  removePermission(permission: string): void {
    this.setState({
      userPermissions: this.state.userPermissions.filter(p => p !== permission)
    });
  }

  setLastApiResponse(response: unknown): void {
    this.setState({ lastApiResponse: response });
  }

  selectItems(items: string[]): void {
    this.setState({ selectedItems: items });
  }

  clearSelection(): void {
    this.setState({ selectedItems: undefined });
  }

  setActiveTab(tab: string): void {
    this.setState({ activeTab: tab });
  }

  // Helper methods for common checks
  hasPermission(permission: string): boolean {
    return this.state.userPermissions.includes(permission);
  }

  isConnected(): boolean {
    return this.state.connectionStatus === 'connected';
  }

  isInModule(module: string): boolean {
    return this.state.currentModule === module;
  }

  hasSelectedItems(): boolean {
    return Boolean(this.state.selectedItems && this.state.selectedItems.length > 0);
  }

  private createContext(state: AppState): CommandContext {
    return {
      state: { ...state },
      permissions: [...state.userPermissions],
      environment: state.environment,
      activeModule: state.currentModule
    };
  }

  private hasContextChanged(oldContext: CommandContext, newContext: CommandContext): boolean {
    // Check if relevant context properties changed
    if (oldContext.activeModule !== newContext.activeModule) return true;
    if (oldContext.environment !== newContext.environment) return true;
    
    // Check permissions
    if (oldContext.permissions?.length !== newContext.permissions?.length) return true;
    if (oldContext.permissions?.some(p => !newContext.permissions?.includes(p))) return true;
    
    return false;
  }

  private notifyListeners(context: CommandContext): void {
    this.listeners.forEach(listener => {
      try {
        listener(context);
      } catch (error) {
        console.error('Error in context change listener:', error);
      }
    });
  }
}

// Global context manager
export const contextManager = new CommandContextManager();

// Utility functions
export const withContext = <T extends unknown[]>(
  fn: (...args: T) => unknown,
  requiredPermissions?: string[],
  requiredModule?: string
) => {
  return (...args: T) => {
    const context = contextManager.getContext();
    
    if (requiredPermissions) {
      const hasAllPermissions = requiredPermissions.every(permission =>
        context.permissions?.includes(permission)
      );
      if (!hasAllPermissions) {
        throw new Error(`Insufficient permissions. Required: ${requiredPermissions.join(', ')}`);
      }
    }
    
    if (requiredModule && context.activeModule !== requiredModule) {
      throw new Error(`This command is only available in the ${requiredModule} module`);
    }
    
    return fn(...args);
  };
};

// Hook-like function for React components (if needed)
export const useCommandContext = () => {
  return {
    state: contextManager.getState(),
    context: contextManager.getContext(),
    setState: contextManager.setState.bind(contextManager),
    setModule: contextManager.setModule.bind(contextManager),
    setConnectionStatus: contextManager.setConnectionStatus.bind(contextManager),
    hasPermission: contextManager.hasPermission.bind(contextManager),
    isConnected: contextManager.isConnected.bind(contextManager),
    isInModule: contextManager.isInModule.bind(contextManager)
  };
};