import { useState } from 'react';
import styled from 'styled-components';

export interface Command {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<string>;
}

interface Props {
  commands: Command[];
  onResult: (result: string) => void;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
`;

const Input = styled.input`
  width: 100%;
  max-width: 500px;
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  border-radius: 4px;
`;

export default function CommandPalette({ commands, onResult }: Props) {
  const [value, setValue] = useState('');

  const runCommand = async () => {
    const [name, ...args] = value.trim().split(/\s+/);
    const cmd = commands.find((c) => c.name === name);
    if (!cmd) {
      onResult(`Unknown command: ${name}`);
      setValue('');
      return;
    }
    try {
      const result = await cmd.handler(args);
      onResult(result);
    } catch (err) {
      onResult(String(err));
    }
    setValue('');
  };

  return (
    <Wrapper>
      <Input
        type="text"
        placeholder="Enter command..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runCommand();
          }
        }}
      />
    </Wrapper>
  );
}
