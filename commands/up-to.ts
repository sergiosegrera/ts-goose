import type { SQL } from "bun";
import { exitSuccess, handleError, handleNoMigrations } from "../error-handler";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";

export async function upToCommand(
  db: SQL,
  store: Store,
  config: { migration_dir: string; table_name: string },
  targetVersion: bigint,
) {
  const table_exists = await store.checkTableExists(db, config.table_name);

  if (!table_exists) {
    await store.createTable(db, config.table_name);
    console.log(`Table ${config.table_name} created.`);
  }

  const migration_versions = await getMigrationVersions(config.migration_dir);
  const versions = await store.getVersions(db, config.table_name);

  // Find the target migration
  const target_migration = migration_versions.find(
    (mv) => mv.version_id === targetVersion,
  );

  if (!target_migration) {
    handleError(`Migration version ${targetVersion} not found.`, {
      command: "up-to",
      version: targetVersion,
    });
  }

  // Get current version
  const current_version = versions[versions.length - 1]?.version_id ?? 0n;

  if (current_version === targetVersion) {
    exitSuccess(`Already at version ${targetVersion}.`);
  }

  if (current_version > targetVersion) {
    handleError(
      `Current version ${current_version} is higher than target version ${targetVersion}. Use "down-to" command to rollback to an earlier version.`,
      { command: "up-to", version: targetVersion },
    );
  }

  // Get all unapplied migrations up to and including the target
  const unapplied_versions = migration_versions.filter(
    (version) =>
      !versions.some((v) => v.version_id === version.version_id) &&
      version.version_id <= targetVersion,
  );

  if (unapplied_versions.length === 0) {
    exitSuccess(`No migrations to apply up to version ${targetVersion}.`);
  }

  const up_migrations = await getMigrations(
    config.migration_dir,
    unapplied_versions,
    "up",
  );

  if (!up_migrations || up_migrations.length === 0) {
    handleNoMigrations({ command: "up-to", version: targetVersion });
  }

  for (const migration of up_migrations) {
    if (!migration) {
      continue;
    }
    await runMigration(db, store, config, migration);
  }

  console.log(
    `${APP_NAME}: successfully migrated database to version: ${targetVersion}`,
  );
}
