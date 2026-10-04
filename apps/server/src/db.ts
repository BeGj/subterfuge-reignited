import postgres from 'postgres';

export type Sql = postgres.Sql;
/** A connection inside `sql.begin(...)`. */
export type Tx = postgres.TransactionSql;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    // Map snake_case columns to camelCase fields in query results.
    transform: postgres.camel,
    onnotice: () => {},
  });
}
