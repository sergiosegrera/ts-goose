export const DEFAULT_FOLDER = "migrations";
export const DEFAULT_TABLE_NAME = "tsgoose.migration";

interface Config {
  migration_dir: string;
  table_name: string;
  driver: string;
  db_url: string;
}

export const DEFAULT_CONFIG: Config = {
  migration_dir: process.env.TSGOOSE_MIGRATION_DIR ?? DEFAULT_FOLDER,
  table_name: DEFAULT_TABLE_NAME,
  driver: process.env.TSGOOSE_DRIVER ?? "postgres",
  db_url:
    process.env.TSGOOSE_DBSTRING ??
    "postgresql://postgres:postgres@localhost:5432/postgres",
};
