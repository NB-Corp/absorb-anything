import { FrameworkError } from "absorb-anything-core";

export interface CliFailure {
  readonly exitCode: number;
  readonly message: string;
}
export function mapCliError(error: unknown): CliFailure {
  if (error instanceof FrameworkError) return { exitCode: 1, message: `Error: ${error.message}` };
  if (error instanceof Error) return { exitCode: 1, message: `Runtime error: ${error.message}` };
  return { exitCode: 1, message: `Runtime error: ${String(error)}` };
}
