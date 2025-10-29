export function helpCommand() {
  console.log(`
ts-goose - A lightweight database migration tool for TypeScript and Bun

USAGE:
  ts-goose <command> [options]

COMMANDS:
  create <name> [sql|ts]  Create a new migration file
  up                      Run all pending migrations
  up-by-one               Run the next pending migration
  up-to VERSION           Migrate the DB to a specific VERSION
  down                    Rollback the last migration
  down-to VERSION         Roll back to a specific VERSION
  reset                   Roll back all migrations
  status                  Show migration status
  version                 Show version information
  help                    Show this help message

EXAMPLES:
  ts-goose create add_users_table
  ts-goose create add_indexes sql
  ts-goose up
  ts-goose up-to 1234567890123
  ts-goose status
  ts-goose down
  ts-goose down-to 1234567890123
  ts-goose reset

For more information, visit: https://github.com/sergiosegrera/ts-goose
`);
}
