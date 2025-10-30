import { DEFAULT_CONFIG } from "../config";
import { handleInvalidArgument } from "../error-handler";
import { createMigration, type MigrationType } from "../migration";

export async function createCommand(args: string[]) {
  const name = args[0];

  // Validate name parameter
  if (!name || name.trim() === "") {
    handleInvalidArgument("Migration name is required and cannot be empty", {
      command: "create",
    });
  }

  // Validate name contains only valid filename characters
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    handleInvalidArgument(
      `Migration name "${name}" contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed`,
      { command: "create" },
    );
  }

  const typeArg = args[1];
  const type: MigrationType = typeArg === "ts" ? "ts" : "sql";
  const config = DEFAULT_CONFIG;

  await createMigration(name, config.migration_dir, type);
}
