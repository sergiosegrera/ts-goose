import type { SQL } from "bun";
import { getMigrationVersions } from "../create";
import { APP_NAME } from "../init";
import type { Store } from "../store";

function formatDate(date: Date): string {
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];

	const dayName = days[date.getDay()];
	const monthName = months[date.getMonth()];
	const day = date.getDate();
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const seconds = date.getSeconds().toString().padStart(2, "0");
	const year = date.getFullYear();

	return `${dayName} ${monthName} ${day.toString().padStart(2, " ")} ${hours}:${minutes}:${seconds} ${year}`;
}

export async function statusCommand(
	db: SQL,
	store: Store,
	config: { migration_dir: string; table_name: string },
) {
	const migration_versions = await getMigrationVersions(config.migration_dir);

	if (migration_versions.length === 0) {
		console.log(
			`No migrations found, you can create one with \`${APP_NAME} create <name> [sql|ts]\``,
		);
		process.exit(0);
	}

	// Check if the table exists
	const table_exists = await store.checkTableExists(db, config.table_name);
	const versions = table_exists
		? await store.getVersions(db, config.table_name)
		: [];

	// Print header
	console.log("Applied At                  Migration");
	console.log("========================================");

	// Print each migration
	for (const migration_version of migration_versions) {
		const applied = versions.find(
			(version) => version.version_id === migration_version.version_id,
		);

		if (applied) {
			const formattedDate = formatDate(applied.applied_at);
			console.log(`${formattedDate} -- ${migration_version.file_name}`);
		} else {
			console.log(`Pending                  -- ${migration_version.file_name}`);
		}
	}
}
