import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import Fuse from 'fuse.js';

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
  align-items: stretch;
  width: 100%;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.05) inset;
`;

const List = styled.ul`
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  width: 100%;
  border: 1px solid #ccc;
  border-radius: 8px;
  overflow: hidden;
`;

const Item = styled.li<{ active: boolean }>`
  padding: 0.75rem 1rem;
  border: 1px solid #ccc;
  border-top: none;
  background-color: ${({ active }) => (active ? '#f0f0f0' : '#fff')};
  cursor: pointer;
  transition: background-color 0.2s;
`;

export default function CommandPalette({ commands, onResult }: Props) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Command[]>(commands);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(
    () => new Fuse(commands, { keys: ['name', 'description'], threshold: 0.4 }),
    [commands]
  );

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions(commands);
      setActive(0);
      return;
    }
    const results = fuse.search(value.trim());
    setSuggestions(results.map((r) => r.item));
    setActive(0);
  }, [value, commands, fuse]);

  const runCommand = async (cmd: Command, args: string[]) => {
    try {
      const result = await cmd.handler(args);
      onResult(result);
    } catch (err) {
      if (err instanceof Error) {
        onResult(err.message);
      } else {
        onResult(String(err));
      }
    }
    setValue('');
  };

  const handleRun = (commandIndex?: number) => {
    if (!suggestions.length) return;
    const [typedName, ...rest] = value.trim().split(/\s+/);
    const selected = suggestions[commandIndex ?? active];
    const args = selected.name === typedName ? rest : [];
    runCommand(selected, args);
  };

  return (
    <Wrapper>
      <Input
        ref={inputRef}
        type="text"
        placeholder="Enter command..."
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            handleRun();
          }
        }}
      />
      {suggestions.length > 0 && (
        <List>
          {suggestions.map((s, i) => (
            <Item
              key={s.name}
              active={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                setActive(i);
                handleRun(i);
              }}
            >
              <strong>{s.name}</strong> - {s.description}
            </Item>
          ))}
        </List>
      )}
    </Wrapper>
  );
}
