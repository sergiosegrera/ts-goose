import type { SQL } from "bun";
import { getMigrationDownStatements, getMigrationVersions } from "../create";
import { APP_NAME } from "../init";
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

  const down_statements = await getMigrationDownStatements(
    config.migration_dir,
    [
      {
        version_id: last_unapplied_version.version_id,
        file_name: last_unapplied_version.file_name,
      },
    ],
  );

  try {
    await db.begin(async (tx) => {
      for (const { version_id, file_name, statements } of down_statements) {
        const startTime = performance.now();
        if (statements.length === 0) {
          console.log(`Empty migration ${file_name}, no updates to apply`);
        } else {
          for (const statement of statements) {
            await store.runMigration(tx, statement);
          }
        }
        await store.deleteVersion(tx, config.table_name, version_id);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        console.log(`OK   ${file_name} (${duration}ms)`);
      }
    });
  } catch (error) {
    console.error(`${APP_NAME}: ERROR ${error}`);
    process.exit(1);
  }
}
