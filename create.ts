import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DOWN_COMMENT,
  extractDownSection,
  extractUpSection,
  parseSqlStatements,
  UP_COMMENT,
} from "./sql-parser";
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
  type: "sql" | "ts" = "sql",
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
	await tx();
};

export const down = async (tx: TransactionSQL) => {
	await tx();
};`,
    );
  }
  console.log(`Migration created: ${migration_path}`);
};

/**
 * Get the migration versions from the folder.
 */
export async function getMigrationVersions(folder: string = "migrations") {
  let file_names: string[] = [];
  try {
    file_names = await readdir(folder);
  } catch {
    file_names = [];
  }

  const versions: {
    version_id: bigint;
    file_name: string;
    type: "sql" | "ts";
  }[] = [];

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
      type: extension as "sql" | "ts",
    });
  }

  // Sort by oldest to newest
  versions.sort((a, b) =>
    a.version_id < b.version_id ? -1 : a.version_id > b.version_id ? 1 : 0,
  );

  return versions;
}

export async function getMigrationUpStatements(
  folder: string,
  versions: { version_id: bigint; file_name: string }[],
): Promise<
  {
    version_id: bigint;
    file_name: string;
    statements: string[];
  }[]
> {
  const statements: {
    version_id: bigint;
    file_name: string;
    statements: string[];
  }[] = [];

  for (const version of versions) {
    const file_content = await readFile(
      path.join(folder, version.file_name),
      "utf8",
    );

    try {
      // Extract UP section using the parser
      const upContent = extractUpSection(
        file_content,
        UP_COMMENT,
        DOWN_COMMENT,
      );

      // Parse statements using the state machine parser
      const { statements: version_statements } = parseSqlStatements(upContent);

      statements.push({
        version_id: version.version_id,
        file_name: version.file_name,
        statements: version_statements,
      });
    } catch (error) {
      throw new Error(
        `Error parsing migration file ${version.file_name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return statements;
}

export async function getMigrationDownStatements(
  folder: string,
  versions: { version_id: bigint; file_name: string }[],
): Promise<
  {
    version_id: bigint;
    file_name: string;
    statements: string[];
  }[]
> {
  const statements: {
    version_id: bigint;
    file_name: string;
    statements: string[];
  }[] = [];

  for (const version of versions) {
    const file_content = await readFile(
      path.join(folder, version.file_name),
      "utf8",
    );

    try {
      // Extract DOWN section using the parser
      const downContent = extractDownSection(file_content, DOWN_COMMENT);

      // Parse statements using the state machine parser
      const { statements: down_statements } = parseSqlStatements(downContent);

      statements.push({
        version_id: version.version_id,
        file_name: version.file_name,
        statements: down_statements,
      });
    } catch (error) {
      throw new Error(
        `Error parsing migration file ${version.file_name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return statements;
}
