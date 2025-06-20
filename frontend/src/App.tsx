import styled from 'styled-components';
import { useState } from 'react';
import FunctionStatus from './FunctionStatus';
import CommandPalette, { Command } from './CommandPalette';

const apiUrl = import.meta.env.VITE_FUNCTION_URL as string;
const mcpUrl = apiUrl.replace(/\/?$/, '') + '/mcp';

const Container = styled.div`
  padding: 2rem;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
`;

const Output = styled.pre`
  max-width: 600px;
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
        const r = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'capabilities' }),
        });
        const data = await r.json();
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'echo',
      description: 'POST /mcp echo <text>',
      handler: async (args: string[]) => {
        const message = args.join(' ');
        const r = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: message }),
        });
        const data = await r.json();
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'list-tools',
      description: 'POST /mcp tools/list',
      handler: async () => {
        const r = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        const data = await r.json();
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'call-dynamo',
      description: 'POST /mcp tools/call dynamodb <json>',
      handler: async (args: string[]) => {
        const bodyArgs = args.join(' ');
        const params = bodyArgs ? JSON.parse(bodyArgs) : {};
        const r = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'dynamodb', arguments: params },
          }),
        });
        const data = await r.json();
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
