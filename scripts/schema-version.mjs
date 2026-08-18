// The persisted metadata marker tracks the newest schema-changing migration,
// not the application package version. Application-only releases must leave it
// unchanged so older compatible readers are not rejected unnecessarily.
export const SCHEMA_VERSION = "0.1.0";
