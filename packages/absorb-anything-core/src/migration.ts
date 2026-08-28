import { withEnvelopeMigrationCoordination } from "./coordination.js";
import { type EnvelopeMigrationResult, migrateEnvelopeUncoordinated } from "./envelope.js";

export function migrateEnvelope(root: string): Promise<EnvelopeMigrationResult> {
  return withEnvelopeMigrationCoordination(root, () => migrateEnvelopeUncoordinated(root));
}
