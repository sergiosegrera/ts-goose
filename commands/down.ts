import type { SQL } from "bun";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";

export async function downCommand(
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

  const last_version = versions[versions.length - 1];

  if (!last_version) {
    console.error(`No migrations to rollback.`);
    process.exit(1);
  }

  const last_unapplied_version = migration_versions.find(
    (version) => version.version_id === last_version.version_id,
  );

  if (!last_unapplied_version) {
    console.error(`No local version to rollback.`);
    process.exit(1);
  }

  const [migration] = await getMigrations(
    config.migration_dir,
    [last_unapplied_version],
    "down",
  );

  if (!migration) {
    console.error(`No migration to rollback.`);
    process.exit(1);
  }

  await runMigration(db, store, config, migration);
}
