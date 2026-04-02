// Barrel export for the database layer
export { openDatabase, getDatabase, getSQLite } from './client';
export * from './schema';
export * from './repositories/fhir.repository';
export * from './repositories/chat.repository';
export * from './repositories/settings.repository';
export * from './repositories/audit.repository';
