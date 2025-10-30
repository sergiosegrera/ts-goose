import type { SQL } from "bun";
import { exitSuccess, handleError } from "../error-handler";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";
import { resetCommand } from "./reset";

export async function downToCommand(
  db: SQL,
  store: Store,
  config: { migration_dir: string; table_name: string },
  targetVersion: bigint,
) {
  // If target is 0, use reset command instead
  if (targetVersion === 0n) {
    await resetCommand(db, store, config);
    return;
  }

  const table_exists = await store.checkTableExists(db, config.table_name);

  if (!table_exists) {
    handleError(`Table ${config.table_name} does not exist.`, {
      command: "down-to",
      tableName: config.table_name,
    });
  }

  const migration_versions = await getMigrationVersions(config.migration_dir);
  const versions = await store.getVersions(db, config.table_name);

  if (versions.length === 0) {
    exitSuccess(`No migrations to rollback.`);
  }

  // Get current version
  const current_version = versions[versions.length - 1]?.version_id ?? 0n;

  if (current_version === targetVersion) {
    exitSuccess(`Already at version ${targetVersion}.`);
  }

  if (current_version < targetVersion) {
    handleError(
      `Current version ${current_version} is lower than target version ${targetVersion}. Use "up-to" command to migrate to a later version.`,
      { command: "down-to", version: targetVersion },
    );
  }

  // Check if target version exists in migrations
  const target_migration = migration_versions.find(
    (mv) => mv.version_id === targetVersion,
  );

  if (!target_migration) {
    handleError(`Migration version ${targetVersion} not found.`, {
      command: "down-to",
      version: targetVersion,
    });
  }

  // Check if target version was ever applied
  const target_applied = versions.find((v) => v.version_id === targetVersion);

  if (!target_applied) {
    handleError(
      `Target version ${targetVersion} has not been applied. Cannot rollback to an unapplied version.`,
      { command: "down-to", version: targetVersion },
    );
  }

  // Rollback all migrations after the target version in reverse order
  const to_rollback = versions.filter((v) => v.version_id > targetVersion);

  for (let i = to_rollback.length - 1; i >= 0; i--) {
    const version = to_rollback[i];

    if (!version) {
      continue;
    }

    const migration_version = migration_versions.find(
      (mv) => mv.version_id === version.version_id,
    );

    if (!migration_version) {
      console.error(
        `No local version found for ${version.version_id}. Skipping...`,
      );
      continue;
    }

    const [migration] = await getMigrations(
      config.migration_dir,
      [migration_version],
      "down",
    );

    if (!migration) {
      console.error(
        `No migration found for ${version.version_id}. Skipping...`,
      );
      continue;
    }

    await runMigration(db, store, config, migration);
  }

  console.log(
    `${APP_NAME}: successfully rolled back to version: ${targetVersion}`,
  );
}
