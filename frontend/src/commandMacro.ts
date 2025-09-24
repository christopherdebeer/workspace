// Command Macros - Chain multiple commands together with conditional execution
import { Command, commandRegistry } from './commandRegistry';

export interface MacroStep {
  commandId: string;
  args?: Record<string, any>;
  condition?: 'always' | 'on-success' | 'on-failure';
  description?: string;
}

export interface CommandMacro {
  id: string;
  name: string;
  description: string;
  steps: MacroStep[];
  category?: string;
  keywords?: string[];
}

export interface MacroExecutionResult {
  success: boolean;
  results: Array<{
    step: MacroStep;
    result?: string;
    error?: string;
    skipped?: boolean;
  }>;
  totalSteps: number;
  executedSteps: number;
}

export class CommandMacroManager {
  private macros = new Map<string, CommandMacro>();

  registerMacro(macro: CommandMacro): void {
    // Create a command for this macro
    const command: Command = {
      id: `macro.${macro.id}`,
      name: macro.name,
      description: `${macro.description} (${macro.steps.length} steps)`,
      category: macro.category || 'Macros',
      keywords: [...(macro.keywords || []), 'macro', 'chain'],
      handler: async () => {
        const result = await this.executeMacro(macro.id);
        return this.formatMacroResult(result);
      }
    };

    commandRegistry.register(command);
    this.macros.set(macro.id, macro);
  }

  unregisterMacro(macroId: string): void {
    commandRegistry.unregister(`macro.${macroId}`);
    this.macros.delete(macroId);
  }

  getMacro(macroId: string): CommandMacro | undefined {
    return this.macros.get(macroId);
  }

  getMacros(): CommandMacro[] {
    return Array.from(this.macros.values());
  }

  async executeMacro(macroId: string): Promise<MacroExecutionResult> {
    const macro = this.macros.get(macroId);
    if (!macro) {
      throw new Error(`Macro ${macroId} not found`);
    }

    const result: MacroExecutionResult = {
      success: true,
      results: [],
      totalSteps: macro.steps.length,
      executedSteps: 0
    };

    let lastStepSuccess = true;

    for (const step of macro.steps) {
      const stepResult = {
        step,
        result: undefined as string | undefined,
        error: undefined as string | undefined,
        skipped: false
      };

      // Check execution condition
      const shouldExecute = this.shouldExecuteStep(step, lastStepSuccess);
      
      if (!shouldExecute) {
        stepResult.skipped = true;
        result.results.push(stepResult);
        continue;
      }

      try {
        const command = commandRegistry.getCommand(step.commandId);
        if (!command) {
          throw new Error(`Command ${step.commandId} not found`);
        }

        const args = step.args || {};
        stepResult.result = await command.handler(args);
        lastStepSuccess = true;
        result.executedSteps++;
      } catch (error) {
        stepResult.error = error instanceof Error ? error.message : String(error);
        lastStepSuccess = false;
        result.success = false;
      }

      result.results.push(stepResult);

      // If this step failed and it's critical, stop execution
      if (!lastStepSuccess && step.condition !== 'on-failure') {
        break;
      }
    }

    return result;
  }

  private shouldExecuteStep(step: MacroStep, lastStepSuccess: boolean): boolean {
    switch (step.condition) {
      case 'on-success':
        return lastStepSuccess;
      case 'on-failure':
        return !lastStepSuccess;
      case 'always':
      default:
        return true;
    }
  }

  private formatMacroResult(result: MacroExecutionResult): string {
    let output = `Macro execution ${result.success ? 'completed' : 'failed'}\n`;
    output += `Executed ${result.executedSteps}/${result.totalSteps} steps\n\n`;

    for (let i = 0; i < result.results.length; i++) {
      const stepResult = result.results[i];
      const stepNum = i + 1;
      
      if (stepResult.skipped) {
        output += `Step ${stepNum}: SKIPPED (${stepResult.step.commandId})\n`;
        if (stepResult.step.description) {
          output += `  ${stepResult.step.description}\n`;
        }
        output += '\n';
        continue;
      }

      const status = stepResult.error ? 'FAILED' : 'SUCCESS';
      output += `Step ${stepNum}: ${status} (${stepResult.step.commandId})\n`;
      
      if (stepResult.step.description) {
        output += `  ${stepResult.step.description}\n`;
      }

      if (stepResult.result) {
        const preview = stepResult.result.length > 100 
          ? stepResult.result.substring(0, 100) + '...'
          : stepResult.result;
        output += `  Result: ${preview}\n`;
      }

      if (stepResult.error) {
        output += `  Error: ${stepResult.error}\n`;
      }

      output += '\n';
    }

    return output;
  }
}

// Global macro manager
export const macroManager = new CommandMacroManager();

// Utility functions for creating macros
export const createMacro = (config: CommandMacro): CommandMacro => config;

export const createMacroStep = (
  commandId: string,
  args?: Record<string, any>,
  options?: {
    condition?: MacroStep['condition'];
    description?: string;
  }
): MacroStep => ({
  commandId,
  args,
  condition: options?.condition || 'always',
  description: options?.description
});