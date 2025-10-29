import type { SQL } from "bun";

export interface Store {
  checkTableExists: (db: SQL, tableName: string) => Promise<boolean>;
  createTable: (db: SQL, tableName: string) => Promise<void>;
  getVersions: (
    db: SQL,
    tableName: string,
  ) => Promise<{ version_id: bigint; applied_at: Date }[]>;
  runMigration: (
    db: SQL,
    statements: string[],
    transaction: boolean,
  ) => Promise<void>;
  insertVersion: (db: SQL, tableName: string, version: bigint) => Promise<void>;
  deleteVersion: (db: SQL, tableName: string, version: bigint) => Promise<void>;
}
