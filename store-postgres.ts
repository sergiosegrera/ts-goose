import type { SQL, TransactionSQL } from "bun";
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
        id uuid primary key not null default gen_random_uuid(),
        version_id bigint not null,
        applied_at timestamp not null default current_timestamp
    )`);
};

const getVersions = async (
	db: SQL,
	tableName: string,
): Promise<{ version_id: bigint; applied_at: Date }[]> => {
	const result = await db.unsafe<{ version_id: bigint; applied_at: Date }[]>(
		`select version_id, applied_at from "${tableName}" order by applied_at asc`,
	);
	return result.map((row) => ({
		version_id: BigInt(row.version_id),
		applied_at: new Date(row.applied_at),
	}));
};

const insertVersion = async (
	tx: TransactionSQL,
	tableName: string,
	version: bigint,
) => {
	await tx.unsafe(
		`insert into "${tableName}" (version_id) values (${version})`,
	);
};

const deleteVersion = async (
	tx: TransactionSQL,
	tableName: string,
	version: bigint,
) => {
	await tx.unsafe(`delete from "${tableName}" where version_id = ${version}`);
};

const runMigration = async (tx: TransactionSQL, statement: string) => {
	await tx.unsafe(statement);
};

export const postgres_store: Store = {
	checkTableExists,
	createTable,
	getVersions,
	insertVersion,
	deleteVersion,
	runMigration,
};
