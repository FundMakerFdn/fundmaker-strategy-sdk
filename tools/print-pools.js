import db from "#src/database.js";
import { pools } from "#src/schema.js";
import fs from "fs";
import { program } from "commander";
import { Parser } from "@json2csv/plainjs";

async function printPools(opts) {
  const rows = await db.select().from(pools);
  const csv = new Parser().parse(rows);

  if (opts.output) {
    fs.writeFile(opts.output, csv, (err) => {
      if (err) {
        console.error(`Error writing to file: ${err}`);
      } else {
        console.log(`Message written to ${opts.output}`);
      }
    });
  } else {
    console.log(csv);
  }

  if (opts.total) {
    console.log("Pool count:", rows.length);
  }
}

program
  .description("Print a CSV of all pools from the database")
  .option("-n, --no-total", "do not print pool count")
  .option("-o, --output <file>", "output file (optional)")
  .action(printPools);

program.parse(process.argv);
