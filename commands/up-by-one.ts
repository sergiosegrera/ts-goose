import type { SQL } from "bun";
import { getMigrationUpStatements, getMigrationVersions } from "../create";
import { APP_NAME } from "../init";
import type { Store } from "../store";

export async function upByOneCommand(
	db: SQL,
	store: Store,
	config: { migration_dir: string; table_name: string },
) {
	const table_exists = await store.checkTableExists(db, config.table_name);

	if (!table_exists) {
		await store.createTable(db, config.table_name);
		console.log(`Table ${config.table_name} created.`);
	}

	const migration_versions = await getMigrationVersions(config.migration_dir);
	const versions = await store.getVersions(db, config.table_name);

	const unapplied_versions = migration_versions.filter(
		(version) => !versions.some((v) => v.version_id === version.version_id),
	);

	const first_unapplied_version = unapplied_versions[0];

	if (!first_unapplied_version) {
		console.error(
			`No migrations to apply, you can create one with \`${APP_NAME} create <name> [sql|ts]\``,
		);
		process.exit(0);
	}

	const up_statements = await getMigrationUpStatements(config.migration_dir, [
		first_unapplied_version,
	]);

	try {
		await db.begin(async (tx) => {
			for (const { version_id, file_name, statements } of up_statements) {
				const startTime = performance.now();
				if (statements.length === 0) {
					console.log(`Empty migration ${file_name}, recording as applied`);
				} else {
					for (const statement of statements) {
						await store.runMigration(tx, statement);
					}
				}
				await store.insertVersion(tx, config.table_name, version_id);
				const endTime = performance.now();
				const duration = (endTime - startTime).toFixed(2);
				console.log(`OK   ${file_name} (${duration}ms)`);
			}
		});

		const last_version = up_statements[up_statements.length - 1];
		if (last_version) {
			console.log(
				`${APP_NAME}: successfully migrated database to version: ${last_version.version_id}`,
			);
		}
	} catch (error) {
		console.error(`${APP_NAME}: ERROR ${error}`);
		process.exit(1);
	}
}
