// Argument Parser - Parse and validate command arguments based on schema
import { ArgumentSchema, ParsedArgs } from './commandRegistry';

export interface ParseError {
  field: string;
  message: string;
}

export interface ParseResult {
  success: boolean;
  args: ParsedArgs;
  errors: ParseError[];
}

export class ArgumentParser {
  parse(input: string, schema?: ArgumentSchema[]): ParseResult {
    const tokens = this.tokenize(input);
    const result: ParseResult = {
      success: true,
      args: {},
      errors: []
    };

    if (!schema || schema.length === 0) {
      // No schema - return all tokens as array for backward compatibility
      result.args = tokens;
      return result;
    }

    // Parse arguments according to schema
    let tokenIndex = 0;
    
    for (const argSchema of schema) {
      const value = this.parseArgument(tokens, tokenIndex, argSchema);
      
      if (value.error) {
        result.errors.push({ field: argSchema.name, message: value.error });
        result.success = false;
      } else {
        result.args[argSchema.name] = value.value;
        tokenIndex += value.consumed;
      }
    }

    // Check for extra tokens
    if (tokenIndex < tokens.length) {
      const extraTokens = tokens.slice(tokenIndex);
      result.errors.push({
        field: '_extra',
        message: `Unexpected arguments: ${extraTokens.join(' ')}`
      });
    }

    return result;
  }

  private tokenize(input: string): string[] {
    // Simple tokenization - can be enhanced for quoted strings, etc.
    return input.trim().split(/\s+/).filter(token => token.length > 0);
  }

  private parseArgument(tokens: string[], startIndex: number, schema: ArgumentSchema): {
    value: string | number | boolean | undefined;
    consumed: number;
    error?: string;
  } {
    if (startIndex >= tokens.length) {
      if (schema.required) {
        return {
          value: undefined,
          consumed: 0,
          error: `Required argument '${schema.name}' is missing`
        };
      }
      return { value: undefined, consumed: 0 };
    }

    const token = tokens[startIndex];

    switch (schema.type) {
      case 'string':
        return { value: token, consumed: 1 };

      case 'number':
        const num = parseFloat(token);
        if (isNaN(num)) {
          return {
            value: undefined,
            consumed: 0,
            error: `'${token}' is not a valid number for argument '${schema.name}'`
          };
        }
        return { value: num, consumed: 1 };

      case 'boolean':
        const lowerToken = token.toLowerCase();
        if (['true', 'yes', '1', 'on'].includes(lowerToken)) {
          return { value: true, consumed: 1 };
        } else if (['false', 'no', '0', 'off'].includes(lowerToken)) {
          return { value: false, consumed: 1 };
        } else {
          return {
            value: undefined,
            consumed: 0,
            error: `'${token}' is not a valid boolean for argument '${schema.name}'`
          };
        }

      case 'choice':
        if (schema.choices && !schema.choices.includes(token)) {
          return {
            value: undefined,
            consumed: 0,
            error: `'${token}' is not a valid choice for '${schema.name}'. Valid choices: ${schema.choices.join(', ')}`
          };
        }
        return { value: token, consumed: 1 };

      default:
        return {
          value: token,
          consumed: 1
        };
    }
  }

  generateHelp(schema: ArgumentSchema[]): string {
    if (!schema || schema.length === 0) {
      return '';
    }

    let help = 'Arguments:\n';
    for (const arg of schema) {
      const required = arg.required ? ' (required)' : ' (optional)';
      const choices = arg.choices ? ` - choices: ${arg.choices.join(', ')}` : '';
      help += `  ${arg.name} (${arg.type})${required}${choices}\n`;
      if (arg.description) {
        help += `    ${arg.description}\n`;
      }
    }
    return help;
  }
}

export const argumentParser = new ArgumentParser();