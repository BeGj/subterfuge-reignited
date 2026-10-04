// `npm run migrate` — apply pending migrations without starting the server.
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { migrate } from './migrate.ts';

const sql = createDb(loadConfig().databaseUrl);
try {
  const ran = await migrate(sql);
  console.log(ran.length ? `Done (${ran.length} applied).` : 'Database is up to date.');
} finally {
  await sql.end();
}
