# frontend/src/

## Purpose
React-based frontend for the workspace productivity application. Mobile-first, composable component architecture.

## Architecture
Mobile-first React application with:
- Command palette interface
- WebAuthn authentication
- MCP client integration
- Plugin system for extensibility

## Key Files

### Core Application
- `main.tsx` - Application entry point
- `App.tsx` - Main application component
- `GlobalStyle.tsx` - Global styled-components styles

### Authentication
- `WebAuthComponent.tsx` - WebAuthn registration and login UI
- `OAuthPage.tsx` - OAuth authorization flow UI
- `FunctionStatus.tsx` - API status indicator

### Command System
- `CommandPalette.tsx` - Command palette UI component
- `commandRegistry.ts` - Command registration and management
- `commandContext.ts` - Application state and context management
- `commandHistory.ts` - Command execution history tracking
- `commandMacro.ts` - Multi-command chaining system
- `commandPlugin.ts` - Plugin architecture for extending commands
- `commandSuggestions.ts` - Fuzzy search and command suggestions
- `commandTemplates.ts` - Template-based command generation
- `defaultCommands.ts` - Core built-in commands
- `examplePlugins.ts` - Example plugins demonstrating capabilities

### Utilities
- `argumentParser.ts` - Command argument parsing with schema validation
- `mcpClient.ts` - MCP protocol client for backend communication
- `useKeyboardShortcuts.ts` - Keyboard shortcut management hook

## Conventions

### TypeScript
- **No `any` types** - Use proper typing for all code
- Use `unknown` for truly unknown data (e.g., API responses)
- Define interfaces for all data structures
- Use `ParsedArgs` type for command arguments
- Prefer union types over loose types

### React Components
- Use functional components with hooks
- Use styled-components for styling
- Follow mobile-first responsive design principles
- Keep components small and composable
- Prefer composition over prop drilling

### State Management
- Use `commandContext.ts` for global application state
- Use `contextManager` for state updates
- React hooks for component-local state
- Event-driven architecture for command system

### Command System
- Register commands through `commandRegistry`
- Use `ParsedArgs` type for handler arguments
- Define argument schemas for validation
- Categorize commands for discoverability
- Add keywords for search

### Naming
- Components: PascalCase (e.g., `CommandPalette.tsx`)
- Utilities: camelCase (e.g., `mcpClient.ts`)
- Interfaces: PascalCase with descriptive names
- Functions: camelCase with verb prefixes

## Plugin Architecture
Plugins can extend the system by:
- Adding new commands
- Registering macros
- Adding templates
- Extending context

See `examplePlugins.ts` for examples.

## Types
All major types are defined in their respective files:
- `Command`, `CommandContext`, `ParsedArgs` - `commandRegistry.ts`
- `AppState` - `commandContext.ts`
- `HistoryEntry` - `commandHistory.ts`
- `CommandMacro`, `MacroStep` - `commandMacro.ts`
- `CommandPlugin` - `commandPlugin.ts`
- `JsonRpcResponse` - `mcpClient.ts`
