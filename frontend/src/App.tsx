import styled from 'styled-components';
import { useState, useEffect, useRef } from 'react';
import GlobalStyle from './GlobalStyle';
import FunctionStatus from './FunctionStatus';
import CommandPalette, { CommandPaletteRef } from './CommandPalette';
import WebAuthComponent from './WebAuthComponent';
import { apiUrl } from './mcpClient';
import { commandRegistry } from './commandRegistry';
import { createDefaultCommands } from './defaultCommands';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { pluginManager } from './commandPlugin';
import { macroManager } from './commandMacro';
import { templateManager, registerDefaultTemplates } from './commandTemplates';
import { contextManager } from './commandContext';
import { examplePlugins } from './examplePlugins';

if (!apiUrl) {
  console.warn('VITE_FUNCTION_URL is not defined, API calls may fail');
}

const Container = styled.div`
  padding: 2rem 1rem;
  min-height: 100vh;
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  gap: 1.5rem;
`;

const Output = styled.pre`
  width: 100%;
  padding: 1rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
`;

export default function App() {
  const [output, setOutput] = useState('');
  const commandPaletteRef = useRef<CommandPaletteRef>(null);

  // Initialize commands in the registry
  useEffect(() => {
    const initializeSystem = async () => {
      // 1. Register default commands
      const defaultCommands = createDefaultCommands();
      defaultCommands.forEach(command => {
        commandRegistry.register(command);
      });

      // 2. Initialize context manager
      contextManager.setConnectionStatus('connecting');
      contextManager.setModule('api');

      // 3. Register default templates
      registerDefaultTemplates();

      // 4. Load example plugins
      for (const plugin of examplePlugins) {
        await pluginManager.loadPlugin(plugin);
      }

      // 5. Update the help command to list all registered commands
      const helpCommand = commandRegistry.getCommand('system.help');
      if (helpCommand) {
        helpCommand.handler = async () => {
          const allCommands = commandRegistry.getCommands();
          const categories = commandRegistry.getCategories();
          const loadedPlugins = pluginManager.getLoadedPlugins();
          const macros = macroManager.getMacros();
          
          let result = '=== Command Palette Help ===\n\n';
          
          if (categories.length > 0) {
            result += '**Available Commands by Category:**\n';
            for (const category of categories) {
              result += `\n**${category}**\n`;
              const categoryCommands = allCommands.filter(cmd => cmd.category === category);
              for (const cmd of categoryCommands) {
                result += `  ${cmd.name}: ${cmd.description}\n`;
              }
            }
          }
          
          if (macros.length > 0) {
            result += '\n**Available Macros:**\n';
            for (const macro of macros) {
              result += `  ${macro.name}: ${macro.description} (${macro.steps.length} steps)\n`;
            }
          }
          
          if (loadedPlugins.length > 0) {
            result += '\n**Loaded Plugins:**\n';
            for (const plugin of loadedPlugins) {
              result += `  ${plugin.name} v${plugin.version}: ${plugin.description}\n`;
            }
          }
          
          result += '\n**Features:**\n';
          result += '  • Type-safe arguments with validation\n';
          result += '  • Command categories and search\n';
          result += '  • Command history and suggestions\n';
          result += '  • Keyboard shortcuts (Cmd/Ctrl+K)\n';
          result += '  • Plugin system and macros\n';
          result += '  • Contextual commands\n';
          
          return result;
        };
      }

      // Set connection status to connected after initialization
      contextManager.setConnectionStatus('connected');
      console.log('Command palette system initialized successfully');
    };

    initializeSystem().catch(error => {
      console.error('Failed to initialize command palette system:', error);
      contextManager.setConnectionStatus('disconnected');
    });
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: 'k',
      ctrlKey: true,
      handler: () => {
        commandPaletteRef.current?.focus();
      }
    },
    {
      key: 'k',
      metaKey: true,
      handler: () => {
        commandPaletteRef.current?.focus();
      }
    }
  ]);

  return (
    <>
      <GlobalStyle />
      <Container>
        <h1>Workspace</h1>
        <FunctionStatus url={apiUrl} />
        <WebAuthComponent />
        {output && <Output>{output}</Output>}
        <CommandPalette ref={commandPaletteRef} onResult={setOutput} />
      </Container>
    </>
  );
}
