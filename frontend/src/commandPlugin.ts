// Command Plugin System - Allow external modules to register commands
import { Command, commandRegistry } from './commandRegistry';

export interface CommandPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  commands: Command[];
  onLoad?: () => void;
  onUnload?: () => void;
  dependencies?: string[];
}

export class CommandPluginManager {
  private plugins = new Map<string, CommandPlugin>();
  private loadedPlugins = new Set<string>();

  async loadPlugin(plugin: CommandPlugin): Promise<boolean> {
    try {
      // Check dependencies
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.isPluginLoaded(dep)) {
            console.warn(`Plugin ${plugin.id} requires dependency ${dep} which is not loaded`);
            return false;
          }
        }
      }

      // Register commands
      for (const command of plugin.commands) {
        commandRegistry.register(command);
      }

      // Store plugin
      this.plugins.set(plugin.id, plugin);
      this.loadedPlugins.add(plugin.id);

      // Call onLoad hook
      if (plugin.onLoad) {
        await plugin.onLoad();
      }

      console.log(`Plugin ${plugin.id} loaded successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to load plugin ${plugin.id}:`, error);
      return false;
    }
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        console.warn(`Plugin ${pluginId} not found`);
        return false;
      }

      // Check if other plugins depend on this one
      const dependentPlugins = Array.from(this.plugins.values()).filter(p =>
        p.dependencies?.includes(pluginId) && this.isPluginLoaded(p.id)
      );

      if (dependentPlugins.length > 0) {
        const names = dependentPlugins.map(p => p.id).join(', ');
        console.warn(`Cannot unload plugin ${pluginId}: required by ${names}`);
        return false;
      }

      // Unregister commands
      for (const command of plugin.commands) {
        commandRegistry.unregister(command.id);
      }

      // Call onUnload hook
      if (plugin.onUnload) {
        await plugin.onUnload();
      }

      // Remove from loaded set
      this.loadedPlugins.delete(pluginId);

      console.log(`Plugin ${pluginId} unloaded successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to unload plugin ${pluginId}:`, error);
      return false;
    }
  }

  isPluginLoaded(pluginId: string): boolean {
    return this.loadedPlugins.has(pluginId);
  }

  getLoadedPlugins(): CommandPlugin[] {
    return Array.from(this.loadedPlugins)
      .map(id => this.plugins.get(id))
      .filter(plugin => plugin !== undefined) as CommandPlugin[];
  }

  getPlugin(pluginId: string): CommandPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  async reloadPlugin(pluginId: string): Promise<boolean> {
    const success = await this.unloadPlugin(pluginId);
    if (success) {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        return await this.loadPlugin(plugin);
      }
    }
    return false;
  }
}

// Global plugin manager
export const pluginManager = new CommandPluginManager();

// Example utility functions for creating plugins
export const createPlugin = (config: Omit<CommandPlugin, 'commands'> & { commands?: Command[] }): CommandPlugin => ({
  commands: [],
  ...config
});

// Plugin loader utilities
export const loadPluginsFromModule = async (moduleLoader: () => Promise<CommandPlugin[]>) => {
  try {
    const plugins = await moduleLoader();
    const results = await Promise.all(
      plugins.map(plugin => pluginManager.loadPlugin(plugin))
    );
    return results.every(success => success);
  } catch (error) {
    console.error('Failed to load plugins from module:', error);
    return false;
  }
};