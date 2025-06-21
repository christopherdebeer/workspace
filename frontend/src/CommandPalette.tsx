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
  padding-bottom: env(safe-area-inset-bottom);
`;

const Input = styled.input`
  width: calc(100vw - 2rem);
  max-width: 500px;
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  position: sticky;
  bottom: 1rem;
  background: white;
`;

export default function CommandPalette({ commands, onResult }: Props) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

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
    setHistory([value, ...history]);
    setHistoryIndex(-1);
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
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const nextIndex = Math.min(historyIndex + 1, history.length - 1);
            if (history[nextIndex]) {
              setValue(history[nextIndex]);
              setHistoryIndex(nextIndex);
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = Math.max(historyIndex - 1, -1);
            if (nextIndex === -1) {
              setValue('');
            } else if (history[nextIndex]) {
              setValue(history[nextIndex]);
            }
            setHistoryIndex(nextIndex);
          } else if (e.key === 'Tab') {
            const match = commands.filter((c) => c.name.startsWith(value));
            if (match.length === 1) {
              e.preventDefault();
              setValue(match[0].name + ' ');
            }
          }
        }}
      />
    </Wrapper>
  );
}
