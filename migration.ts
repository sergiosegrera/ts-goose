import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SQL } from "bun";
import { handleMigrationError } from "./error-handler";
import { DOWN_COMMENT, parseSQLFile, UP_COMMENT } from "./sql-parser";
import type { Store } from "./store";

export type MigrationType = "sql" | "ts";
export type MigrationDirection = "up" | "down";

export type SQLMigration = {
  type: "sql";
  version_id: bigint;
  file_name: string;
  statements: string[];
  transaction: boolean;
  direction: MigrationDirection;
};

export type TSMigration = {
  type: "ts";
  version_id: bigint;
  file_name: string;
  direction: MigrationDirection;
};

export type Migration = SQLMigration | TSMigration;

export type MigrationVersion = {
  version_id: bigint;
  file_name: string;
  type: MigrationType;
};

export async function createFolder(folder: string = "migrations") {
  try {
    await mkdir(folder);
    return true;
  } catch {
    return true;
  }
}

// Prefix is timestamp
export const createMigration = async (
  name: string = "new",
  folder: string = "migrations",
  type: MigrationType = "sql",
) => {
  await createFolder(folder);
  const timestamp = Date.now();
  const migration_file_name = `${timestamp}_${name}.${type}`;
  const migration_path = path.join(folder, migration_file_name);
  if (type === "sql") {
    await writeFile(migration_path, `${UP_COMMENT}\n\n${DOWN_COMMENT}`);
  } else if (type === "ts") {
    await writeFile(
      migration_path,
      `import type { TransactionSQL } from "bun";

export const up = async (tx: TransactionSQL) => {
	await tx\`\`;
};

export const down = async (tx: TransactionSQL) => {
	await tx\`\`;
};`,
    );
  }
  console.log(`Migration created: ${migration_path}`);
};

/**
 * Get the migration versions from the folder.
 */
export async function getMigrationVersions(
  folder: string = "migrations",
): Promise<MigrationVersion[]> {
  let file_names: string[] = [];
  try {
    file_names = await readdir(folder);
  } catch {
    file_names = [];
  }

  const versions: MigrationVersion[] = [];

  for (const file_name of file_names) {
    const prefix = file_name.split("_")[0];

    if (!prefix) {
      throw new Error(`Invalid migration file: ${file_name}`);
    }

    const version_id = BigInt(prefix);

    const extension = file_name.split(".")[1];

    if (extension !== "sql" && extension !== "ts") {
      throw new Error(`Invalid migration file: ${file_name}`);
    }

    versions.push({
      version_id,
      file_name,
      type: extension as MigrationType,
    });
  }

  // Sort by oldest to newest
  versions.sort((a, b) =>
    a.version_id < b.version_id ? -1 : a.version_id > b.version_id ? 1 : 0,
  );

  return versions;
}

export async function getMigrations(
  folder: string,
  versions: { version_id: bigint; file_name: string }[],
  direction: MigrationDirection,
): Promise<Migration[]> {
  const migrations: Migration[] = [];

  for (const version of versions) {
    // Check the file type
    const extension = version.file_name.split(".")[1];
    if (extension !== "sql" && extension !== "ts") {
      throw new Error(`Invalid migration file: ${version.file_name}`);
    }

    if (extension === "sql") {
      const { statements, transaction } = await parseSQLFile(
        direction,
        folder,
        version,
      );

      migrations.push({
        direction,
        version_id: version.version_id,
        file_name: version.file_name,
        type: "sql",
        statements,
        transaction,
      });
    } else if (extension === "ts") {
      migrations.push({
        version_id: version.version_id,
        file_name: version.file_name,
        type: "ts",
        direction,
      });
    }
  }

  return migrations;
}

export async function runMigration(
  db: SQL,
  store: Store,
  config: { table_name: string; migration_dir: string },
  migration: Migration,
) {
  const start_time = performance.now();
  try {
    if (migration.type === "sql") {
      await runSQLMigration(db, store, migration);
    } else if (migration.type === "ts") {
      await runTSMigration(db, migration, config);
    }

    console.log(
      `OK\t${migration.file_name} (${(performance.now() - start_time).toFixed(2)}ms)`,
    );
  } catch (error) {
    const errorMessage = `Error running ${migration.direction} migration ${migration.file_name}: ${error instanceof Error ? error.message : "Unknown error"}`;
    handleMigrationError(errorMessage, {
      command: migration.direction,
      fileName: migration.file_name,
      version: migration.version_id,
      originalError: error instanceof Error ? error : undefined,
    });
  }

  if (migration.direction === "up") {
    await store.insertVersion(db, config.table_name, migration.version_id);
  } else if (migration.direction === "down") {
    await store.deleteVersion(db, config.table_name, migration.version_id);
  }
}

async function runSQLMigration(db: SQL, store: Store, migration: SQLMigration) {
  if (migration.statements.length > 0) {
    await store.runMigration(db, migration.statements, migration.transaction);
  }
}

async function runTSMigration(
  db: SQL,
  migration: TSMigration,
  config: { migration_dir: string },
) {
  // import the file and run the up and down functions
  const absolutePath = path.resolve(config.migration_dir, migration.file_name);
  const file = await import(absolutePath);
  if (migration.direction === "up") {
    await db.begin(async (tx) => {
      await file.up(tx);
    });
  } else if (migration.direction === "down") {
    await db.begin(async (tx) => {
      await file.down(tx);
    });
  }
}
