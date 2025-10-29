import type { SQL } from "bun";
import { APP_NAME } from "../init";
import {
  getMigrations,
  getMigrationVersions,
  runMigration,
} from "../migration";
import type { Store } from "../store";

export async function upCommand(
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

  if (unapplied_versions.length === 0) {
    console.error(
      `No migrations to apply, you can create one with \`${APP_NAME} create <name> [sql|ts]\``,
    );
    process.exit(0);
  }

  const up_migrations = await getMigrations(
    config.migration_dir,
    unapplied_versions,
    "up",
  );

  if (!up_migrations) {
    console.error(`No migrations to apply.`);
    process.exit(1);
  }

  for (const migration of up_migrations) {
    if (!migration) {
      continue;
    }
    await runMigration(db, store, config, migration);
  }

  console.log(
    `${APP_NAME}: successfully migrated database to version: ${up_migrations[up_migrations.length - 1]?.version_id}`,
  );
}
