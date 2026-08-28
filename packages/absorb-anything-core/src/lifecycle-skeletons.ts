import { FrameworkError } from "./errors.js";

export interface AdoptExistingProjectOptions {
  readonly root: string;
  readonly name?: string;
  readonly dryRun?: boolean;
  readonly apply?: boolean;
}

export interface ConvertOverlayToStandaloneOptions {
  readonly root: string;
  readonly target: string;
  readonly move?: boolean;
  readonly keepOverlay?: boolean;
}

/** Reserved core contract; the CLI does not expose adoption in the first product milestone. */
export async function adoptExistingProject(_options: AdoptExistingProjectOptions): Promise<never> {
  throw new FrameworkError("The adopt lifecycle is reserved and is not active in 0.1.0.");
}

/** Reserved core contract; the CLI does not expose conversion in the first product milestone. */
export async function convertOverlayToStandalone(
  _options: ConvertOverlayToStandaloneOptions,
): Promise<never> {
  throw new FrameworkError("The convert lifecycle is reserved and is not active in 0.1.0.");
}
