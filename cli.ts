#!/usr/bin/env bun
import { createCommand } from "./commands/create";
import { downCommand } from "./commands/down";
import { downToCommand } from "./commands/down-to";
import { helpCommand } from "./commands/help";
import { resetCommand } from "./commands/reset";
import { statusCommand } from "./commands/status";
import { upCommand } from "./commands/up";
import { upByOneCommand } from "./commands/up-by-one";
import { upToCommand } from "./commands/up-to";
import { versionCommand } from "./commands/version";
import { initializeDatabase } from "./init";

const command = process.argv[2];

const commands = {
  create: "create",
  up: "up",
  "up-by-one": "up-by-one",
  "up-to": "up-to",
  status: "status",
  down: "down",
  "down-to": "down-to",
  reset: "reset",
  version: "version",
  help: "help",
};

// Handle special flags and no command
if (!command || command === "--help" || command === "-h") {
  helpCommand();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  versionCommand();
  process.exit(0);
}

if (!Object.keys(commands).includes(command)) {
  console.error(`Invalid command: ${command}`);
  console.log('Run "ts-goose help" for usage information.');
  process.exit(1);
}

switch (command) {
  case "create": {
    const args = process.argv.slice(3);
    await createCommand(args);
    break;
  }

  case "status": {
    const { db, store, config } = initializeDatabase();
    await statusCommand(db, store, config);
    break;
  }

  case "up": {
    const { db, store, config } = initializeDatabase();
    await upCommand(db, store, config);
    break;
  }

  case "up-by-one": {
    const { db, store, config } = initializeDatabase();
    await upByOneCommand(db, store, config);
    break;
  }

  case "up-to": {
    const targetVersion = process.argv[3];
    if (!targetVersion) {
      console.error("Error: VERSION argument is required");
      console.log("Usage: ts-goose up-to <VERSION>");
      process.exit(1);
    }
    try {
      const versionBigInt = BigInt(targetVersion);
      const { db, store, config } = initializeDatabase();
      await upToCommand(db, store, config, versionBigInt);
    } catch {
      console.error(`Error: Invalid version "${targetVersion}"`);
      process.exit(1);
    }
    break;
  }

  case "down": {
    const { db, store, config } = initializeDatabase();
    await downCommand(db, store, config);
    break;
  }

  case "down-to": {
    const targetVersion = process.argv[3];
    if (!targetVersion) {
      console.error("Error: VERSION argument is required");
      console.log("Usage: ts-goose down-to <VERSION>");
      process.exit(1);
    }
    try {
      const versionBigInt = BigInt(targetVersion);
      const { db, store, config } = initializeDatabase();
      await downToCommand(db, store, config, versionBigInt);
    } catch {
      console.error(`Error: Invalid version "${targetVersion}"`);
      process.exit(1);
    }
    break;
  }

  case "reset": {
    const { db, store, config } = initializeDatabase();
    await resetCommand(db, store, config);
    break;
  }

  case "version": {
    versionCommand();
    break;
  }

  case "help": {
    helpCommand();
    break;
  }
}
