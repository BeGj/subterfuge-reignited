import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    // Map snake_case columns to camelCase fields in query results.
    transform: postgres.camel,
    onnotice: () => {},
  });
}
