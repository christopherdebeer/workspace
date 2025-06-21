import styled from 'styled-components';
import { useState, useEffect } from 'react';
import FunctionStatus from './FunctionStatus';
import CommandPalette, { Command } from './CommandPalette';
import { McpClient } from './client/McpClient';

const apiUrl = (import.meta.env.VITE_FUNCTION_URL as string | undefined) ?? '';
if (!apiUrl) {
  console.warn('VITE_FUNCTION_URL is not defined, API calls may fail');
}

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
  const [commands, setCommands] = useState<Command[]>([]);

  const client = new McpClient(apiUrl);

  const buildCommands = (tools: any[]): Command[] => {
    const dynamic = tools.map<Command>((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      handler: async (args: string[]) => {
        const body = args.join(' ');
        const params = body ? JSON.parse(body) : {};
        const result = await client.callTool(tool.name, params);
        return JSON.stringify(result, null, 2);
      },
    }));

    const builtIns: Command[] = [
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
        name: 'refresh-tools',
        description: 'Refresh available tools',
        handler: async () => {
          const tools = await client.listTools();
          setCommands(buildCommands(tools));
          return `Loaded ${tools.length} tools`;
        },
      },
      {
        name: 'echo',
        description: 'POST /mcp echo <text>',
        handler: async (args: string[]) => {
          const message = args.join(' ');
          const res = await client.request('echo', message);
          return JSON.stringify(res.result, null, 2);
        },
      },
      {
        name: 'help',
        description: 'List commands',
        handler: async () =>
          [...builtIns, ...dynamic]
            .map((c) => `${c.name}: ${c.description}`)
            .join('\n'),
      },
    ];

    return [...builtIns, ...dynamic];
  };

  useEffect(() => {
    client.listTools().then((tools) => {
      setCommands(buildCommands(tools));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container>
      <h1>Hello from React</h1>
      <FunctionStatus url={apiUrl} />
      {output && <Output>{output}</Output>}
      <CommandPalette commands={commands} onResult={setOutput} />
    </Container>
  );
}
