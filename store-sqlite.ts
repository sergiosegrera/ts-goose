import type { SQL } from "bun";
import type { Store } from "./store";

const checkTableExists = async (db: SQL, tableName: string) => {
  try {
    await db.unsafe(`select count(id) from "${tableName}" limit 1;`);
  } catch {
    return false;
  }

  return true;
};

const createTable = async (db: SQL, tableName: string) => {
  await db.unsafe(`create table if not exists "${tableName}" (
        id text primary key not null default (lower(hex(randomblob(16)))),
        version_id integer not null,
        applied_at text not null default (datetime('now'))
    )`);
};

const getVersions = async (
  db: SQL,
  tableName: string,
): Promise<{ version_id: bigint; applied_at: Date }[]> => {
  const result = await db.unsafe<{ version_id: bigint; applied_at: string }[]>(
    `select version_id, applied_at from "${tableName}" order by applied_at asc`,
  );
  return result.map((row) => ({
    version_id: BigInt(row.version_id),
    applied_at: new Date(row.applied_at),
  }));
};

const insertVersion = async (db: SQL, tableName: string, version: bigint) => {
  await db.unsafe(
    `insert into "${tableName}" (version_id) values (${version})`,
  );
};

const deleteVersion = async (db: SQL, tableName: string, version: bigint) => {
  await db.unsafe(`delete from "${tableName}" where version_id = ${version}`);
};

const runMigration = async (
  db: SQL,
  statements: string[],
  transaction: boolean,
) => {
  if (transaction) {
    await db.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
    });
    return;
  }

  for (const statement of statements) {
    await db.unsafe(statement);
  }
};

export const SQLiteStore: Store = {
  checkTableExists,
  createTable,
  getVersions,
  insertVersion,
  deleteVersion,
  runMigration,
};
