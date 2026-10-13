import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

function readMigrationFiles() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  return files.map((fileName) => {
    const filePath = path.join(migrationsDir, fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    return { fileName, filePath, content };
  });
}

function main() {
  const migrations = readMigrationFiles();

  if (!migrations.length) {
    console.error('No SQL migration files found in supabase/migrations.');
    process.exit(1);
  }

  const seen = new Map();
  const failures = [];

  for (const migration of migrations) {
    const match = migration.fileName.match(/^(\d{14})_/);
    if (!match) {
      failures.push(`${migration.fileName}: filename must begin with YYYYMMDDHHMMSS_`);
      continue;
    }

    const ts = match[1];
    if (seen.has(ts)) {
      failures.push(`${migration.fileName}: duplicate migration timestamp ${ts}`);
    }
    seen.set(ts, migration.fileName);
  }

  const initialProfiles = migrations.find((migration) => migration.fileName === '20260902000000_initial_profiles.sql');
  if (!initialProfiles) {
    failures.push('Missing required migration: 20260902000000_initial_profiles.sql');
  }

  const profilesTableRegex = /create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?public\.profiles\b/i;
  const profilesCreated = migrations.some((migration) => profilesTableRegex.test(migration.content));
  if (!profilesCreated) {
    failures.push('No migration creates public.profiles.');
  }

  const firstProfilesIndex = migrations.findIndex((migration) => profilesTableRegex.test(migration.content));
  const firstTrainingIndex = migrations.findIndex((migration) => migration.fileName === '20260903000000_training_module.sql');

  if (firstProfilesIndex !== -1 && firstTrainingIndex !== -1 && firstProfilesIndex > firstTrainingIndex) {
    failures.push('public.profiles is created after 20260903000000_training_module.sql. Reorder the migration chain to create profiles first.');
  }

  const referencesProfiles = migrations.filter((migration) => /public\.profiles\b/i.test(migration.content));
  const earliestReference = referencesProfiles.length
    ? migrations.findIndex((migration) => /public\.profiles\b/i.test(migration.content))
    : -1;

  if (earliestReference !== -1 && firstProfilesIndex !== -1 && earliestReference < firstProfilesIndex) {
    failures.push('Found a migration referencing public.profiles before any creation migration exists.');
  }

  if (failures.length) {
    console.error('Supabase migration validation failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Static filename/order checks passed for ${migrations.length} migration files in ${path.relative(repoRoot, migrationsDir)}.`);
  console.log('Required early profile migration present and ordered before dependent migrations.');
  console.log('This check does not execute SQL or verify database dependencies.');
}

main();
