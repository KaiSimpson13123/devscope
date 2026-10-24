import { getDb, getDatabasePath } from '../lib/db';

const db = getDb();
const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all();
console.log('[DevScope] SQLite database initialized at:', getDatabasePath());
console.log('[DevScope] Applied migrations:', rows);
