import {failureRecord} from '../public/core/failures.mjs';
import {
  ConflictError,
  ValidationError,
  applyAction,
  createTask,
  sanitizeDecision,
  TERMINAL_STATUSES,
} from '../public/core/tasks.mjs';

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_updated_at ON tasks(updated_at DESC);
CREATE TABLE IF NOT EXISTS usage (
  provider TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0);
`;

class D1NotFoundError extends Error {
  constructor() { super('task not found'); this.statusCode = 404; }
}

export class D1TaskStore {
  constructor(database, options = {}) {
    if (!database) throw new Error('D1 database binding is required');
    this.db = database;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async createTask(input) {
    const task = createTask(input, {now: this.now, id: this.id});
    await this.db.batch([
      this.db.prepare('INSERT INTO tasks (id, version, updated_at, body) VALUES (?1, ?2, ?3, ?4)')
        .bind(task.id, task.version, task.updatedAt, JSON.stringify(task)),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision'"),
    ]);
    return task;
  }

  async getTask(id) {
    const row = await this.db.prepare('SELECT body FROM tasks WHERE id = ?1').bind(id).first();
    return row ? JSON.parse(row.body) : null;
  }

  async requireTask(id) {
    const task = await this.getTask(id);
    if (!task) throw new D1NotFoundError();
    return task;
  }

  async listTasks() {
    const result = await this.db.prepare('SELECT body FROM tasks ORDER BY updated_at DESC, id ASC').all();
    return result.results.map(row => JSON.parse(row.body));
  }

  async getState(capabilities = {}, since) {
    const row=await this.db.prepare("SELECT value FROM metadata WHERE key = 'revision'").first();
    const revision=Number(row?.value??0);
    if(Number.isSafeInteger(since)&&since>=0&&since===revision)return {revision,unchanged:true,capabilities};
    const [tasks,usage]=await Promise.all([this.listTasks(),this.db.prepare('SELECT body FROM usage ORDER BY provider').all()]);
    return {revision,tasks,usage:usage.results.map(row=>JSON.parse(row.body)),capabilities};
  }

  async replaceTask(id, expectedVersion, updater) {
    const current = await this.requireTask(id);
    if (!Number.isInteger(expectedVersion)) throw new ValidationError('expectedVersion is required');
    if (current.version !== expectedVersion) {
      throw new ConflictError(`version conflict: expected ${expectedVersion}, current ${current.version}`, current.version);
    }
    const next = updater(structuredClone(current));
    if (!next || next.id !== current.id || next.version !== current.version + 1) {
      throw new Error('task updater must increment version exactly once');
    }
    const results = await this.db.batch([
      this.db.prepare('UPDATE tasks SET version = ?1, updated_at = ?2, body = ?3 WHERE id = ?4 AND version = ?5')
        .bind(next.version, next.updatedAt, JSON.stringify(next), id, expectedVersion),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision' AND changes() = 1"),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const latest = await this.requireTask(id);
      throw new ConflictError('task changed during update', latest.version);
    }
    return next;
  }

  applyAction(id, input) {
    return this.replaceTask(id, input?.expectedVersion, current => applyAction(current, input, {now: this.now, id: this.id}));
  }

  async applyExecutionAction(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      return applyAction(current, {...input, expectedVersion: current.version}, {now: this.now, id: this.id});
    });
  }

  async requestDecision(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      const decision = sanitizeDecision(input);
      return {
        ...current, status: 'waiting_user', version: current.version + 1, updatedAt: now,
        decision: {...decision, createdAt: now},
        checkpoint: {...current.checkpoint, status: 'waiting_user', content: decision.prompt, updatedAt: now},
      };
    });
  }

  markWaiting(id, {expectedVersion, provider, reason}) {
    return this.replaceTask(id, expectedVersion, current => {
      if (TERMINAL_STATUSES.includes(current.status)) throw new ConflictError('task is terminal', current.version);
      const now = this.now();
      return {
        ...current, status: 'waiting_connection', version: current.version + 1, updatedAt: now,
        checkpoint: {...(current.checkpoint ?? {}), provider, status: 'waiting_connection', content: current.checkpoint?.content ?? reason, failure: failureRecord({failure:{kind:'unavailable'}},now), updatedAt: now},
      };
    });
  }

  claimExecution(id, {provider, expectedVersion, leaseMs = 15 * 60_000}) {
    if (!['codex', 'claude'].includes(provider)) throw new ValidationError('provider must be codex or claude');
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 60 * 60_000) throw new ValidationError('invalid execution lease');
    let claim;
    return this.replaceTask(id, expectedVersion, current => {
      if (TERMINAL_STATUSES.includes(current.status) || current.status === 'paused') {
        throw new ConflictError(`task cannot run from ${current.status}`, current.version);
      }
      const now = this.now();
      const nowMs = Date.parse(now);
      const previous = current.checkpoint ?? {};
      if (current.status === 'running' && Date.parse(previous.expiresAt) > nowMs) {
        throw new ConflictError('execution lease is already owned', current.version);
      }
      claim = {
        executionId: this.id(),
        generation: Number.isInteger(previous.generation) ? previous.generation + 1 : 1,
      };
      return {
        ...current, status: 'running', version: current.version + 1, updatedAt: now,
        checkpoint: {
          ...previous, failure: undefined, ...claim, provider, status: 'running', claimedAt: now,
          expiresAt: new Date(nowMs + leaseMs).toISOString(), updatedAt: now,
        },
      };
    }).then(task => ({...claim, task}));
  }

  assertExecution(task, input) {
    if (
      task.status !== 'running'
      || task.checkpoint?.executionId !== input.executionId
      || task.checkpoint?.generation !== input.generation
    ) throw new ConflictError('stale execution owner cannot write this task', task.version);
  }

  async finishExecution(id, input, {recoverInterrupted = false} = {}) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      const sameInterruptedOwner = recoverInterrupted
        && current.status === 'paused'
        && current.checkpoint?.interruptedBy === 'lease_expiry'
        && current.checkpoint?.interruptedVersion === current.version
        && current.checkpoint?.executionId === input.executionId
        && current.checkpoint?.generation === input.generation;
      if (!sameInterruptedOwner) this.assertExecution(current, input);
      const now = this.now();
      const content = typeof input.content === 'string' ? input.content.trim() : '';
      if (!content) throw new ValidationError('execution result content is required');
      const sourceArtifacts = Array.isArray(input.artifacts) && input.artifacts.length
        ? input.artifacts
        : [{name: 'final.md', mime: 'text/markdown', content, encoding: 'utf-8'}];
      if (sourceArtifacts.length > 10) throw new ValidationError('execution returned too many artifacts');
      let total = 0;
      const artifacts = sourceArtifacts.map(item => {
        if (!item || typeof item !== 'object') throw new ValidationError('execution artifact is invalid');
        const artifactContent = typeof item.content === 'string' ? item.content : '';
        total += artifactContent.length;
        if (total > 10_000_000) throw new ValidationError('execution artifacts are too large');
        const encoding = item.encoding ?? 'utf-8';
        if (!['utf-8', 'base64'].includes(encoding)) throw new ValidationError('execution artifact encoding is invalid');
        return {
          id: this.id(), name: String(item.name || 'artifact.txt').slice(0, 500),
          mime: String(item.mime || 'text/plain').slice(0, 255), content: artifactContent,
          encoding, createdAt: now,
        };
      });
      return {
        ...current, status: 'completed', version: current.version + 1, updatedAt: now,
        messages: [...current.messages, {id: this.id(), role: 'assistant', content, createdAt: now}],
        artifacts: [...current.artifacts, ...artifacts],
        checkpoint: {...current.checkpoint, failure: undefined, status: 'completed', content: input.checkpoint ?? 'Execution completed.', completedAt: now, updatedAt: now},
      };
    });
  }

  async leaveExecutionRunning(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      return {
        ...current, status: 'running', version: current.version + 1, updatedAt: now,
        checkpoint: {...current.checkpoint, status: 'running', content: current.checkpoint?.content ?? input.checkpoint, sessionUrl: input.sessionUrl, updatedAt: now},
      };
    });
  }

  async failExecution(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      const failure = failureRecord(input, now);
      const status = failure.kind === 'quota' ? 'waiting_quota' : failure.kind === 'authentication' ? 'waiting_connection' : 'failed';
      return {
        ...current, status, version: current.version + 1, updatedAt: now,
        checkpoint: {...current.checkpoint, status, failure, updatedAt: now},
      };
    });
  }

  async recordUsage(provider, usage = {}) {
    const record = {
      provider, usedPercent: Number.isFinite(usage.usedPercent) ? usage.usedPercent : null,
      resetAt: usage.resetAt ?? null, inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
      outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
      updatedAt: this.now(), source: usage.source ?? 'executor_event',
    };
    await this.db.batch([
      this.db.prepare('INSERT INTO usage (provider, body) VALUES (?1, ?2) ON CONFLICT(provider) DO UPDATE SET body = excluded.body')
        .bind(provider, JSON.stringify(record)),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision'"),
    ]);
    return record;
  }
}
