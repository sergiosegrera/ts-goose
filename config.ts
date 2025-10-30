export const DEFAULT_FOLDER = "./migrations";
export const DEFAULT_TABLE_NAME = "tsgoose.migration";
export const DEFAULT_DRIVER = "postgres";
export const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";

export interface Config {
  migration_dir: string;
  table_name: string;
  driver: string;
  db_url: string;
}

function validateTableName(tableName: string): string {
  // Basic validation to prevent SQL injection in table names
  // Allow alphanumeric characters, dots, underscores, and hyphens
  if (!/^[a-zA-Z0-9._-]+$/.test(tableName)) {
    throw new Error(
      `Invalid table name "${tableName}". Table names must contain only letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  return tableName;
}

export const DEFAULT_CONFIG: Config = {
  migration_dir: process.env.TSGOOSE_MIGRATION_DIR ?? DEFAULT_FOLDER,
  table_name: validateTableName(
    process.env.TSGOOSE_TABLE_NAME ?? DEFAULT_TABLE_NAME,
  ),
  driver: process.env.TSGOOSE_DRIVER ?? DEFAULT_DRIVER,
  db_url: process.env.TSGOOSE_DBSTRING ?? DEFAULT_DB_URL,
};
