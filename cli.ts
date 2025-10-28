#!/usr/bin/env bun
import { createCommand } from "./commands/create";
import { downCommand } from "./commands/down";
import { statusCommand } from "./commands/status";
import { upCommand } from "./commands/up";
import { upByOneCommand } from "./commands/up-by-one";
import { initializeDatabase } from "./init";

const command = process.argv[2];

const commands = {
  create: "create",
  up: "up",
  "up-by-one": "up-by-one",
  status: "status",
  down: "down",
};

if (command && !Object.keys(commands).includes(command)) {
  console.error(`Invalid command: ${command}`);
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

  case "down": {
    const { db, store, config } = initializeDatabase();
    await downCommand(db, store, config);
    break;
  }
}
