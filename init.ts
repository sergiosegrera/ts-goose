import { SQL } from "bun";
import { DEFAULT_CONFIG } from "./config";
import { PostgresStore } from "./store-postgres";

export const APP_NAME = "@ssegrera/ts-goose";

export function initializeDatabase() {
  const config = DEFAULT_CONFIG;

  let db: SQL;

  if (config.driver === "postgres") {
    db = new SQL(config.db_url, { adapter: "postgres" });
  } else {
    throw new Error(`Unsupported driver: ${config.driver}`);
  }

  const store = PostgresStore;

  return { db, store, config };
}
