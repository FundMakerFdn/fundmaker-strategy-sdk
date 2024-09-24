import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  sqliteTable,
  integer,
  text,
  unique,
  foreignKey,
} from "drizzle-orm/sqlite-core";

import * as schema from "./schema.js";

// Initialize SQLite connection
const sqlite = new Database("data.db");

// Initialize Drizzle ORM with SQLite connection
const db = drizzle(sqlite);

// Export database connection and schema
export default db;
