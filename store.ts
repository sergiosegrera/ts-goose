import type { SQL, TransactionSQL } from "bun";

export interface Store {
	checkTableExists: (db: SQL, tableName: string) => Promise<boolean>;
	createTable: (db: SQL, tableName: string) => Promise<void>;
	getVersions: (
		db: SQL,
		tableName: string,
	) => Promise<{ version_id: bigint; applied_at: Date }[]>;
	runMigration: (tx: TransactionSQL, statement: string) => Promise<void>;
	insertVersion: (
		tx: TransactionSQL,
		tableName: string,
		version: bigint,
	) => Promise<void>;
	deleteVersion: (
		tx: TransactionSQL,
		tableName: string,
		version: bigint,
	) => Promise<void>;
}
