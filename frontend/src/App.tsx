import styled from 'styled-components';
import { useState, useEffect } from 'react';
import GlobalStyle from './GlobalStyle';
import FunctionStatus from './FunctionStatus';
import CommandPalette from './CommandPalette';
import WebAuthComponent from './WebAuthComponent';
import { apiUrl } from './mcpClient';
import { commandRegistry } from './commandRegistry';
import { createDefaultCommands } from './defaultCommands';

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

  // Initialize commands in the registry
  useEffect(() => {
    const defaultCommands = createDefaultCommands();
    defaultCommands.forEach(command => {
      commandRegistry.register(command);
    });

    // Update the help command to list all registered commands
    const helpCommand = commandRegistry.getCommand('system.help');
    if (helpCommand) {
      helpCommand.handler = async () => {
        const allCommands = commandRegistry.getCommands();
        const categories = commandRegistry.getCategories();
        
        if (categories.length > 0) {
          let result = 'Available commands by category:\n\n';
          for (const category of categories) {
            result += `**${category}**\n`;
            const categoryCommands = allCommands.filter(cmd => cmd.category === category);
            for (const cmd of categoryCommands) {
              result += `  ${cmd.name}: ${cmd.description}\n`;
            }
            result += '\n';
          }
          return result;
        } else {
          return allCommands.map((c) => `${c.name}: ${c.description}`).join('\n');
        }
      };
    }
  }, []);

  return (
    <>
      <GlobalStyle />
      <Container>
        <h1>Workspace</h1>
        <FunctionStatus url={apiUrl} />
        <WebAuthComponent />
        {output && <Output>{output}</Output>}
        <CommandPalette onResult={setOutput} />
      </Container>
    </>
  );
}
