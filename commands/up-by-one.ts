import type { SQL } from "bun";
import { exitSuccess, handleNoMigrations } from "../error-handler";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";

export async function upByOneCommand(
  db: SQL,
  store: Store,
  config: { migration_dir: string; table_name: string },
) {
  const table_exists = await store.checkTableExists(db, config.table_name);

  if (!table_exists) {
    await store.createTable(db, config.table_name);
    console.log(`Table ${config.table_name} created.`);
  }

  const migration_versions = await getMigrationVersions(config.migration_dir);
  const versions = await store.getVersions(db, config.table_name);

  const unapplied_versions = migration_versions.filter(
    (version) => !versions.some((v) => v.version_id === version.version_id),
  );

  const first_unapplied_version = unapplied_versions[0];

  if (!first_unapplied_version) {
    exitSuccess(
      `No migrations to apply, you can create one with \`${APP_NAME} create <name> [sql|ts]\``,
    );
  }

  const [up_migration] = await getMigrations(
    config.migration_dir,
    [first_unapplied_version],
    "up",
  );

  if (!up_migration) {
    handleNoMigrations({
      command: "up-by-one",
      version: first_unapplied_version.version_id,
      fileName: first_unapplied_version.file_name,
    });
  }

  await runMigration(db, store, config, up_migration);

  console.log(
    `${APP_NAME}: successfully migrated database to version: ${up_migration.version_id}`,
  );
}
