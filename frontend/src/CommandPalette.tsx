import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import Fuse from 'fuse.js';
import { Command, CommandRegistry, commandRegistry } from './commandRegistry';
import { commandHistory } from './commandHistory';

interface Props {
  registry?: CommandRegistry;
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

const ItemContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const ItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Category = styled.span`
  background: #e3f2fd;
  color: #1565c0;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
`;

const Description = styled.span`
  color: #666;
  font-size: 0.875rem;
`;

export default function CommandPalette({ registry = commandRegistry, onResult }: Props) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => registry.getCommands(), [registry]);

  const fuse = useMemo(
    () => new Fuse(commands, { 
      keys: ['name', 'description', 'category', 'keywords'], 
      threshold: 0.4,
      includeScore: true
    }),
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
    let result: string = '';
    let error: string | undefined = undefined;
    
    try {
      result = await cmd.handler(args);
      onResult(result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      onResult(error);
    }
    
    // Add to history
    commandHistory.addEntry(cmd.name, args, result, error);
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
              key={s.id}
              active={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                setActive(i);
                handleRun(i);
              }}
            >
              <ItemContent>
                <ItemHeader>
                  <strong>{s.name}</strong>
                  {s.category && <Category>{s.category}</Category>}
                </ItemHeader>
                <Description>{s.description}</Description>
              </ItemContent>
            </Item>
          ))}
        </List>
      )}
    </Wrapper>
  );
}
