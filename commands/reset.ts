import type { SQL } from "bun";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";

export async function resetCommand(
  db: SQL,
  store: Store,
  config: { migration_dir: string; table_name: string },
) {
  const table_exists = await store.checkTableExists(db, config.table_name);

  if (!table_exists) {
    console.error(`Table ${config.table_name} does not exist.`);
    process.exit(1);
  }

  const migration_versions = await getMigrationVersions(config.migration_dir);
  const versions = await store.getVersions(db, config.table_name);

  if (versions.length === 0) {
    console.log(`No migrations to rollback.`);
    process.exit(0);
  }

  // Roll back all migrations in reverse order

  for (let i = versions.length - 1; i >= 0; i--) {
    const version = versions[i];

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

  console.log(`All migrations rolled back successfully.`);
}
