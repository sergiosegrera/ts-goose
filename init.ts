import { SQL } from "bun";
import { DEFAULT_CONFIG } from "./config";
import type { Store } from "./store";
import { PostgresStore } from "./store-postgres";
import { SQLiteStore } from "./store-sqlite";

export const APP_NAME = "ts-goose";

export function initializeDatabase() {
  const config = DEFAULT_CONFIG;

  let db: SQL;
  let store: Store;

  if (config.driver === "postgres") {
    db = new SQL(config.db_url, { adapter: "postgres" });
    store = PostgresStore;
  } else if (config.driver === "sqlite") {
    db = new SQL(config.db_url, { adapter: "sqlite" });
    store = SQLiteStore;
  } else {
    throw new Error(`Unsupported driver: ${config.driver}`);
  }

  return { db, store, config };
}
