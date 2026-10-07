import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PollConfig } from './domain.js';

export type Draft = { id: string; conversationId: string; ownerId: string; messageId: string | null; createdAt: string };
export type Option = { id: string; name: string; url: string | null };
export type Vote = { memberId: string; memberName: string; choices: string[] };
export type Poll = {
  id: string; draftId: string; conversationId: string; ownerId: string; ownerName: string; title: string;
  multiple: boolean; deadline: string | null; messageId: string | null; status: 'publishing' | 'open' | 'closed';
  publishState: 'ready' | 'uncertain'; revision: number; publishedRevision: number; options: Option[]; votes: Vote[];
};

const pollColumns = `id, draft_id AS draftId, conversation_id AS conversationId, owner_id AS ownerId, owner_name AS ownerName,
  title, multiple, deadline, message_id AS messageId, status, publish_state AS publishState, revision, published_revision AS publishedRevision`;

export class Store {
  private constructor(private db: DatabaseSync) {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversation (id TEXT PRIMARY KEY, reference_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draft (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, owner_id TEXT NOT NULL, message_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS poll (id TEXT PRIMARY KEY, draft_id TEXT UNIQUE NOT NULL REFERENCES draft(id), conversation_id TEXT NOT NULL,
        owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, title TEXT NOT NULL, multiple INTEGER NOT NULL CHECK(multiple IN (0,1)), deadline TEXT,
        message_id TEXT, status TEXT NOT NULL CHECK(status IN ('publishing','open','closed')), publish_state TEXT NOT NULL DEFAULT 'ready',
        revision INTEGER NOT NULL DEFAULT 1, published_revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS poll_option (poll_id TEXT NOT NULL REFERENCES poll(id), id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, url TEXT,
        PRIMARY KEY(poll_id,id), UNIQUE(poll_id,position));
      CREATE TABLE IF NOT EXISTS vote (poll_id TEXT NOT NULL REFERENCES poll(id), member_id TEXT NOT NULL, member_name TEXT NOT NULL,
        choices_json TEXT NOT NULL CHECK(json_valid(choices_json)), updated_at TEXT NOT NULL, PRIMARY KEY(poll_id,member_id));`);
  }
  static open(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    return new Store(new DatabaseSync(path));
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  activateConversation(id: string, reference: unknown) {
    this.db.prepare('INSERT INTO conversation VALUES (?,?) ON CONFLICT(id) DO UPDATE SET reference_json=excluded.reference_json').run(id, JSON.stringify(reference));
  }
  conversationReference(id: string): unknown {
    const row = this.db.prepare('SELECT reference_json FROM conversation WHERE id=?').get(id) as { reference_json: string } | undefined;
    return row ? JSON.parse(row.reference_json) : undefined;
  }
  createDraft(conversationId: string, ownerId: string, now = new Date()): Draft {
    const draft = { id: randomUUID(), conversationId, ownerId, messageId: null, createdAt: now.toISOString() };
    this.db.prepare('INSERT INTO draft VALUES (?,?,?,?,?)').run(draft.id, conversationId, ownerId, null, draft.createdAt);
    return draft;
  }
  getDraft(id: string): Draft | undefined {
    return this.db.prepare('SELECT id, conversation_id AS conversationId, owner_id AS ownerId, message_id AS messageId, created_at AS createdAt FROM draft WHERE id=?').get(id) as Draft | undefined;
  }
  setDraftMessage(id: string, messageId: string) { this.db.prepare('UPDATE draft SET message_id=? WHERE id=?').run(messageId, id); }
  pollForDraft(draftId: string): Poll | undefined {
    const row = this.db.prepare('SELECT id FROM poll WHERE draft_id=?').get(draftId) as { id: string } | undefined;
    return row && this.getPoll(row.id);
  }
  createPoll(draftId: string, ownerName: string, config: PollConfig): Poll {
    return this.transaction(() => {
      const existing = this.pollForDraft(draftId);
      if (existing) return existing;
      const draft = this.getDraft(draftId)!;
      const id = randomUUID();
      this.db.prepare(`INSERT INTO poll (id,draft_id,conversation_id,owner_id,owner_name,title,multiple,deadline,status) VALUES (?,?,?,?,?,?,?,?, 'publishing')`)
        .run(id, draftId, draft.conversationId, draft.ownerId, ownerName, config.title, Number(config.multiple), config.deadline);
      for (const [index, option] of config.options.entries())
        this.db.prepare('INSERT INTO poll_option VALUES (?,?,?,?,?)').run(id, String(index + 1), index, option.name, option.url);
      return this.getPoll(id)!;
    });
  }
  getPoll(id: string): Poll | undefined {
    const row = this.db.prepare(`SELECT ${pollColumns} FROM poll WHERE id=?`).get(id) as Omit<Poll, 'options' | 'votes' | 'multiple'> & { multiple: number } | undefined;
    if (!row) return undefined;
    const options = this.db.prepare('SELECT id,name,url FROM poll_option WHERE poll_id=? ORDER BY position').all(id) as Option[];
    const votes = (this.db.prepare('SELECT member_id AS memberId, member_name AS memberName, choices_json FROM vote WHERE poll_id=? ORDER BY member_name,member_id').all(id) as { memberId: string; memberName: string; choices_json: string }[])
      .map(({ choices_json, ...vote }) => ({ ...vote, choices: JSON.parse(choices_json) as string[] }));
    return { ...row, multiple: Boolean(row.multiple), options, votes };
  }
  beginPublish(id: string) {
    return this.db.prepare("UPDATE poll SET publish_state='uncertain' WHERE id=? AND status='publishing' AND publish_state='ready'").run(id).changes === 1;
  }
  allowPublishRetry(id: string) { this.db.prepare("UPDATE poll SET publish_state='ready' WHERE id=? AND status='publishing'").run(id); }
  markPublished(id: string, messageId: string, revision: number) {
    this.db.prepare("UPDATE poll SET message_id=?,status='open',published_revision=? WHERE id=? AND status='publishing'").run(messageId, revision, id);
  }
  saveVote(id: string, memberId: string, memberName: string, choices: string[], now = new Date()) {
    return this.transaction(() => {
      const json = JSON.stringify(choices);
      const previous = this.db.prepare('SELECT choices_json,member_name FROM vote WHERE poll_id=? AND member_id=?').get(id, memberId) as { choices_json: string; member_name: string } | undefined;
      if (previous?.choices_json === json && previous.member_name === memberName) return false;
      this.db.prepare(`INSERT INTO vote VALUES (?,?,?,?,?) ON CONFLICT(poll_id,member_id) DO UPDATE SET member_name=excluded.member_name, choices_json=excluded.choices_json, updated_at=excluded.updated_at`)
        .run(id, memberId, memberName, json, now.toISOString());
      this.db.prepare('UPDATE poll SET revision=revision+1 WHERE id=?').run(id);
      return Boolean(previous);
    });
  }
  closePoll(id: string) { this.db.prepare("UPDATE poll SET status='closed',revision=revision+1 WHERE id=? AND status='open'").run(id); }
  markUpdated(id: string, revision: number) { this.db.prepare('UPDATE poll SET published_revision=max(published_revision,?) WHERE id=?').run(revision, id); }
  listDirtyPolls(): Poll[] {
    return (this.db.prepare("SELECT id FROM poll WHERE message_id IS NOT NULL AND revision>published_revision").all() as { id: string }[]).map(row => this.getPoll(row.id)!);
  }
  closeDuePolls(now = new Date()) {
    this.db.prepare("UPDATE poll SET status='closed',revision=revision+1 WHERE status='open' AND deadline IS NOT NULL AND deadline<=?").run(now.toISOString());
  }
}
