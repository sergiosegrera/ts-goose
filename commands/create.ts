import { DEFAULT_CONFIG } from "../config";
import { createMigration } from "../migration";

export async function createCommand(args: string[]) {
  const name = args[0];
  const type = args[1] as "sql" | "ts" | undefined;
  const config = DEFAULT_CONFIG;

  await createMigration(name, config.migration_dir, type);
}
