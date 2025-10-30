import type { SQL } from "bun";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";
import { handleError, handleNoMigrations } from "../error-handler";

export async function downCommand(
  db: SQL,
  store: Store,
  config: { migration_dir: string; table_name: string },
) {
  const table_exists = await store.checkTableExists(db, config.table_name);

  if (!table_exists) {
    handleError(`Table ${config.table_name} does not exist.`, { command: "down", tableName: config.table_name });
  }

  const migration_versions = await getMigrationVersions(config.migration_dir);
  const versions = await store.getVersions(db, config.table_name);

  const last_version = versions[versions.length - 1];

  if (!last_version) {
    handleNoMigrations({ command: "down" });
  }

  const last_unapplied_version = migration_versions.find(
    (version) => version.version_id === last_version.version_id,
  );

  if (!last_unapplied_version) {
    handleNoMigrations({ command: "down", version: last_version.version_id });
  }

  const [migration] = await getMigrations(
    config.migration_dir,
    [last_unapplied_version],
    "down",
  );

  if (!migration) {
    handleNoMigrations({ command: "down", version: last_unapplied_version.version_id, fileName: last_unapplied_version.file_name });
  }

  await runMigration(db, store, config, migration);
}
