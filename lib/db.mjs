import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const TYPES = ['episodic', 'semantic', 'procedural', 'preference', 'working']
export const STATUSES = ['proposed', 'approved', 'superseded', 'disputed', 'deleted']
export const LIVE = ['approved', 'proposed']

export const synapseHome = () => process.env.SYNAPSE_HOME || join(homedir(), '.claude', 'synapse')

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS records (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('episodic','semantic','procedural','preference','working')),
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','superseded','disputed','deleted')),
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  expires INTEGER,
  superseded_by TEXT
);
CREATE INDEX IF NOT EXISTS records_project ON records (project_id, status);
CREATE TABLE IF NOT EXISTS links (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='records', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO fts (fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE OF text ON records BEGIN
  INSERT INTO fts (fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS packs (key TEXT PRIMARY KEY, pack TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root TEXT NOT NULL, status TEXT NOT NULL,
  plan TEXT NOT NULL, snapshot TEXT NOT NULL, digest TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
`

export function openStore(path = join(synapseHome(), 'brain.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  return new Store(db)
}

class Store {
  constructor(db) {
    this.db = db
  }

  /** Bumps a named counter and returns its new value. */
  incr(key) {
    this.db.prepare(`INSERT INTO meta (k, v) VALUES (?, '1') ON CONFLICT (k) DO UPDATE SET v = CAST(CAST(meta.v AS INTEGER) + 1 AS TEXT)`).run(key)
    return Number(this.db.prepare('SELECT v FROM meta WHERE k = ?').get(key).v)
  }

  version() {
    return this.db.prepare("SELECT v FROM meta WHERE k = 'version'").get()?.v ?? '0'
  }

  add({ projectId, type, text, status = 'proposed', source = '', expires = null, now = Date.now() }) {
    if (!TYPES.includes(type)) throw new Error(`unknown type: ${type}`)
    if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`)
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO records (id, project_id, type, status, text, source, created, updated, expires) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, projectId, type, status, text, source, now, now, expires)
    this.incr('version')
    return id
  }

  get(id) {
    return this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) ?? null
  }

  setStatus(id, status, now = Date.now()) {
    if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`)
    this.db.prepare('UPDATE records SET status = ?, updated = ? WHERE id = ?').run(status, now, id)
    this.incr('version')
  }

  link(fromId, toId, kind) {
    this.db.prepare('INSERT OR IGNORE INTO links (from_id, to_id, kind) VALUES (?,?,?)').run(fromId, toId, kind)
  }

  /** The new record replaces the old one; the old one keeps its text and points at its successor. */
  supersede(oldId, newId, now = Date.now()) {
    this.db.prepare("UPDATE records SET status = 'superseded', superseded_by = ?, updated = ? WHERE id = ?").run(newId, now, oldId)
    this.link(newId, oldId, 'supersedes')
    this.incr('version')
  }

  /** Lineage for duplicates: the old record is folded into the kept one. */
  merge(oldId, keepId, now = Date.now()) {
    this.db.prepare("UPDATE records SET status = 'superseded', superseded_by = ?, updated = ? WHERE id = ?").run(keepId, now, oldId)
    this.link(oldId, keepId, 'merged_into')
    this.incr('version')
  }

  /** Soft delete: the text is blanked, which removes the record from the full-text index through the update trigger. */
  forget(id, now = Date.now()) {
    this.db.prepare("UPDATE records SET text = '', status = 'deleted', updated = ? WHERE id = ?").run(now, id)
    this.incr('version')
  }

  list(projectId, statuses = LIVE, now = Date.now()) {
    const ph = statuses.map(() => '?').join(',')
    return this.db
      .prepare(`SELECT * FROM records WHERE project_id = ? AND status IN (${ph}) AND (expires IS NULL OR expires > ?) ORDER BY created`)
      .all(projectId, ...statuses, now)
  }

  /** Full-text search with BM25. Cross-project recall needs crossProject: true and is off by default. */
  search(projectId, query, { limit = 50, crossProject = false, now = Date.now() } = {}) {
    const terms = [...new Set((query || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])]
    const live = `r.status IN ('approved','proposed') AND (r.expires IS NULL OR r.expires > ?)`
    const scope = crossProject ? '1 = 1' : 'r.project_id = ?'
    const scopeArgs = crossProject ? [] : [projectId]
    if (terms.length === 0) {
      return this.db
        .prepare(`SELECT r.*, 0 AS score FROM records r WHERE ${live} AND ${scope} ORDER BY r.updated DESC LIMIT ?`)
        .all(now, ...scopeArgs, limit)
    }
    const match = terms.map((t) => `"${t}"`).join(' OR ')
    return this.db
      .prepare(`SELECT r.*, bm25(fts) AS score FROM fts JOIN records r ON r.rowid = fts.rowid WHERE fts MATCH ? AND ${live} AND ${scope} ORDER BY score LIMIT ?`)
      .all(match, now, ...scopeArgs, limit)
  }

  close() {
    this.db.close()
  }
}
