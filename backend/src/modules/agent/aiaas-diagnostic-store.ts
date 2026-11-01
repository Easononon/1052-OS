import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { HttpError } from '../../http-error.js'

export type DiagnosticScopeRecord = { deploymentId: string; revision: string; enabled: boolean;
  modelFingerprint: string; allowedSourceIds: string[] }
export type DiagnosticLease = { deploymentId: string; revision: string; ownerKey: string;
  chatId: string; runId: string }

export class DiagnosticLeaseStore {
  private db: Database.Database
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 2000')
    this.db.exec(`CREATE TABLE IF NOT EXISTS scopes(id TEXT PRIMARY KEY,revision TEXT NOT NULL,
      enabled INTEGER NOT NULL,fingerprint TEXT NOT NULL,sources TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY,deployment TEXT NOT NULL,
      revision TEXT NOT NULL,owner TEXT NOT NULL,chat TEXT NOT NULL,status TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_chat ON runs(deployment,chat,status);`)
  }
  close() { this.db.close() }
  getScope(deploymentId: string): DiagnosticScopeRecord | null {
    const row = this.db.prepare('SELECT * FROM scopes WHERE id=?').get(deploymentId) as
      { id: string; revision: string; enabled: number; fingerprint: string; sources: string } | undefined
    return row ? { deploymentId: row.id, revision: row.revision, enabled: row.enabled === 1,
      modelFingerprint: row.fingerprint, allowedSourceIds: JSON.parse(row.sources) as string[] } : null
  }
  setScope(scope: DiagnosticScopeRecord, expectedRevision: string | null) {
    this.db.transaction(() => {
      const current = this.getScope(scope.deploymentId)
      if ((current?.revision ?? null) !== expectedRevision) throw new HttpError(409, 'scope_changed')
      this.db.prepare('INSERT OR REPLACE INTO scopes VALUES(?,?,?,?,?)').run(
        scope.deploymentId, scope.revision, scope.enabled ? 1 : 0, scope.modelFingerprint, JSON.stringify(scope.allowedSourceIds))
      this.db.prepare("UPDATE runs SET status='revoked' WHERE deployment=? AND status='running'").run(scope.deploymentId)
    }).immediate()
  }
  claim(lease: DiagnosticLease): DiagnosticLease {
    this.db.transaction(() => {
      const scope = this.getScope(lease.deploymentId)
      if (!scope?.enabled || scope.revision !== lease.revision) throw new HttpError(409, 'scope_changed')
      const previous = this.db.prepare('SELECT owner FROM runs WHERE deployment=? AND chat=? LIMIT 1')
        .get(lease.deploymentId, lease.chatId) as { owner: string } | undefined
      if (previous && previous.owner !== lease.ownerKey) throw new HttpError(404, 'session_not_found')
      const running = this.db.prepare("SELECT 1 FROM runs WHERE deployment=? AND chat=? AND status='running' AND expires>?")
        .get(lease.deploymentId, lease.chatId, Date.now())
      if (running) throw new HttpError(409, 'in_progress')
      this.db.prepare('DELETE FROM runs WHERE expires<?').run(Date.now() - 86400000)
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(lease.runId, lease.deploymentId,
        lease.revision, lease.ownerKey, lease.chatId, 'running', Date.now() + 200000)
    }).immediate()
    return lease
  }
  assertLease(lease: DiagnosticLease) {
    const scope = this.getScope(lease.deploymentId)
    const row = this.db.prepare('SELECT status,expires,owner,chat FROM runs WHERE run_id=?').get(lease.runId) as
      { status: string; expires: number; owner: string; chat: string } | undefined
    if (!scope?.enabled || scope.revision !== lease.revision || !row || row.status !== 'running'
      || row.expires <= Date.now() || row.owner !== lease.ownerKey || row.chat !== lease.chatId) {
      throw new HttpError(409, 'scope_changed')
    }
  }
  finish(lease: DiagnosticLease) {
    this.db.prepare("UPDATE runs SET status='finished' WHERE run_id=? AND status='running'").run(lease.runId)
  }
  revokeRun(deploymentId: string, revision: string, runId: string) {
    this.db.prepare("UPDATE runs SET status='revoked' WHERE deployment=? AND revision=? AND run_id=?")
      .run(deploymentId, revision, runId)
  }
}
