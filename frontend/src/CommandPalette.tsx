import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import styled from 'styled-components';
import Fuse from 'fuse.js';
import { Command, CommandRegistry, commandRegistry } from './commandRegistry';
import { commandHistory } from './commandHistory';
import { argumentParser } from './argumentParser';
import { suggestionEngine, CommandSuggestion } from './commandSuggestions';

interface Props {
  registry?: CommandRegistry;
  onResult: (result: string) => void;
}

export interface CommandPaletteRef {
  focus: () => void;
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

const Preview = styled.div`
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  font-size: 0.875rem;
`;

const PreviewTitle = styled.h4`
  margin: 0 0 0.5rem 0;
  color: #495057;
  font-size: 0.875rem;
  font-weight: 600;
`;

const PreviewText = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  color: #6c757d;
  font-size: 0.8rem;
  font-family: 'Courier New', monospace;
`;

const SuggestionsList = styled.div`
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: #f0f9ff;
  border: 1px solid #0ea5e9;
  border-radius: 6px;
`;

const SuggestionsTitle = styled.h4`
  margin: 0 0 0.5rem 0;
  color: #0c4a6e;
  font-size: 0.875rem;
  font-weight: 600;
`;

const SuggestionItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0;
  border-bottom: 1px solid #e0f2fe;
  
  &:last-child {
    border-bottom: none;
  }
`;

const SuggestionName = styled.span`
  font-weight: 500;
  color: #0c4a6e;
  cursor: pointer;
  
  &:hover {
    text-decoration: underline;
  }
`;

const SuggestionReason = styled.span`
  font-size: 0.75rem;
  color: #0369a1;
  font-style: italic;
`;

const CommandPalette = forwardRef<CommandPaletteRef, Props>(({ registry = commandRegistry, onResult }, ref) => {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const [commandSuggestions, setCommandSuggestions] = useState<CommandSuggestion[]>([]);
  const [lastExecutedCommand, setLastExecutedCommand] = useState<Command | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    }
  }));

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
    // Clear command suggestions when user starts typing
    if (commandSuggestions.length > 0) {
      setCommandSuggestions([]);
    }
  }, [value, commands, fuse, commandSuggestions.length]);

  const runCommand = async (cmd: Command, argsString: string) => {
    let result: string = '';
    let error: string | undefined = undefined;
    
    try {
      // Parse arguments using the schema
      const parseResult = argumentParser.parse(argsString, cmd.args);
      
      if (!parseResult.success) {
        const errorMessages = parseResult.errors.map(e => `${e.field}: ${e.message}`);
        error = `Argument errors:\n${errorMessages.join('\n')}`;
        if (cmd.args && cmd.args.length > 0) {
          error += `\n\n${argumentParser.generateHelp(cmd.args)}`;
        }
        onResult(error);
      } else {
        // Use parsed args if schema exists, otherwise fall back to string array
        const handlerArgs = cmd.args && cmd.args.length > 0 ? parseResult.args : argsString.split(/\s+/).filter(s => s);
        result = await cmd.handler(handlerArgs);
        onResult(result);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      onResult(error);
    }
    
    // Add to history
    commandHistory.addEntry(cmd.name, argsString.split(/\s+/).filter(s => s), result, error);
    
    // Generate suggestions for next command
    if (!error) {
      setLastExecutedCommand(cmd);
      const newSuggestions = suggestionEngine.generateSuggestions(cmd, commands);
      setCommandSuggestions(newSuggestions);
    }
    
    setValue('');
  };

  const handleRun = (commandIndex?: number) => {
    if (!suggestions.length) return;
    const [typedName, ...rest] = value.trim().split(/\s+/);
    const selected = suggestions[commandIndex ?? active];
    const argsString = selected.name === typedName ? rest.join(' ') : '';
    runCommand(selected, argsString);
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
              onMouseEnter={() => setActive(i)}
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
      
      {/* Command Preview */}
      {suggestions.length > 0 && active < suggestions.length && suggestions[active].args && suggestions[active].args!.length > 0 && (
        <Preview>
          <PreviewTitle>{suggestions[active].name} - Arguments</PreviewTitle>
          <PreviewText>{argumentParser.generateHelp(suggestions[active].args!)}</PreviewText>
        </Preview>
      )}
      
      {/* Command Suggestions */}
      {commandSuggestions.length > 0 && !value.trim() && (
        <SuggestionsList>
          <SuggestionsTitle>
            Suggested commands {lastExecutedCommand && `(after ${lastExecutedCommand.name})`}
          </SuggestionsTitle>
          {commandSuggestions.map((suggestion) => (
            <SuggestionItem key={suggestion.command.id}>
              <SuggestionName 
                onClick={() => {
                  setValue(suggestion.command.name);
                  setCommandSuggestions([]);
                  inputRef.current?.focus();
                }}
              >
                {suggestion.command.name}
              </SuggestionName>
              <SuggestionReason>{suggestion.reason.reason}</SuggestionReason>
            </SuggestionItem>
          ))}
        </SuggestionsList>
      )}
    </Wrapper>
  );
});

CommandPalette.displayName = 'CommandPalette';
export default CommandPalette;
