![goose logo](/assets/goose_256.png)

# ts-goose

A lightweight database migration tool for TypeScript and Bun, inspired by goose.

## Installation

### Using bunx (recommended)

```bash
bunx @ssegrera/ts-goose [command]
```

### Using pnpmx/npx

```bash
pnpx @ssegrera/ts-goose [command]
# or
npx @ssegrera/ts-goose [command]
```

### Global installation

```bash
# Using bun
bun add -g @ssegrera/ts-goose

# Using pnpm
pnpm add -g @ssegrera/ts-goose

# Using npm
npm install -g @ssegrera/ts-goose
```

## Usage

### Commands

- `ts-goose create <name> [sql|ts]` - Create a new migration file
- `ts-goose up` - Apply all pending migrations
- `ts-goose up-by-one` - Apply the next pending migration
- `ts-goose down` - Rollback the last applied migration
- `ts-goose status` - Show migration status

### Examples

```bash
# Create a new SQL migration
bunx @ssegrera/ts-goose create add_users_table sql

# Create a new TypeScript migration
bunx @ssegrera/ts-goose create add_products_table ts

# Apply the next migration
bunx @ssegrera/ts-goose up

# Check migration status
bunx @ssegrera/ts-goose status

# Rollback the last migration
bunx @ssegrera/ts-goose down
```

## Configuration

The following environment variables can be used to configure the tool:
- `TSGOOSE_DRIVER` - The database driver to use (currently only `postgres` is supported)
- `TSGOOSE_DBSTRING` - The database connection string to use (defaults to `postgresql://postgres:postgres@localhost:5432/postgres`)
- `TSGOOSE_MIGRATION_DIR` - The directory containing the migration files (defaults to `migrations`)
- `TSGOOSE_TABLE_NAME` - The name of the table to use for storing the migration history (defaults to `tsgoose.migration`)

## Using as a Library

You can also use ts-goose programmatically in your TypeScript/Bun projects:

```typescript
import { SQL } from "bun";
import { upCommand, PostgresStore, DEFAULT_CONFIG } from "@ssegrera/ts-goose";

// Connect to postgres database
const db = new SQL(DEFAULT_CONFIG.db_url);

// Run migrations
await upCommand(db, PostgresStore, {
  migration_dir: DEFAULT_CONFIG.migration_dir,
  table_name: DEFAULT_CONFIG.table_name,
});

// Close connection
await db.end();
```

This allows you to integrate migration execution into your application startup, tests, or custom deployment scripts.


## Development

To install dependencies:

```bash
bun install
```

To run locally:

```bash
bun run index.ts [command]
```

To run tests:

```bash
bun test
```

To build:

```bash
bun run build
```

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
