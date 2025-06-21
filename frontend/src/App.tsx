import styled from 'styled-components';
import { useState } from 'react';
import FunctionStatus from './FunctionStatus';
import CommandPalette, { Command } from './CommandPalette';
import { apiUrl, mcpRequest, callTool } from './mcpClient';

if (!apiUrl) {
  console.warn('VITE_FUNCTION_URL is not defined, API calls may fail');
}

const Container = styled.div`
  padding: 1rem;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  font-family: sans-serif;
`;

const Output = styled.pre`
  max-width: 90vw;
  white-space: pre-wrap;
  word-break: break-word;
`;

export default function App() {
  const [output, setOutput] = useState('');

  const commands: Command[] = [
    {
      name: 'status',
      description: 'GET /',
      handler: async () => {
        const r = await fetch(apiUrl);
        const data = await r.json();
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'capabilities',
      description: 'POST /mcp capabilities',
      handler: async () => {
        const data = await mcpRequest('capabilities');
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'echo',
      description: 'POST /mcp echo <text>',
      handler: async (args: string[]) => {
        const message = args.join(' ');
        const data = await mcpRequest('echo', message);
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'list-tools',
      description: 'POST /mcp tools/list',
      handler: async () => {
        const data = await mcpRequest('tools/list');
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'call-dynamo',
      description: 'POST /mcp tools/call dynamodb <json>',
      handler: async (args: string[]) => {
        const bodyArgs = args.join(' ');
        const params = bodyArgs ? JSON.parse(bodyArgs) : {};
        const data = await callTool('dynamodb', params);
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'help',
      description: 'List commands',
      handler: async () =>
        commands.map((c) => `${c.name}: ${c.description}`).join('\n'),
    },
  ];

  return (
    <Container>
      <h1>Hello from React</h1>
      <FunctionStatus url={apiUrl} />
      {output && <Output>{output}</Output>}
      <CommandPalette commands={commands} onResult={setOutput} />
    </Container>
  );
}
