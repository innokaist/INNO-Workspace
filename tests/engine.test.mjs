import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ConflictError,
  TERMINAL_STATUSES,
  applyAction,
  createTask,
} from '../public/core/tasks.mjs';

const fixed = {
  now: () => '2026-09-13T01:02:03.000Z',
  id: (() => {
    let value = 0;
    return () => `id-${++value}`;
  })(),
};

test('createTask stores attachment descriptors without source bytes or browser objects', () => {
  const task = createTask({
    prompt: '문헌 검토',
    type: 'literature',
    attachments: [{
      id: 'a',
      name: 'paper.txt',
      path: 'papers/paper.txt',
      size: 6,
      lastModified: 42,
      type: 'text/plain',
      source: 'file',
      content: 'secret-source-bytes',
      data: new Uint8Array([1, 2, 3]),
      file: {text: async () => 'secret-source-bytes'},
      unexpected: 'also-secret',
    }],
  }, fixed);

  assert.deepEqual(task.attachments, [{
    id: 'a',
    name: 'paper.txt',
    path: 'papers/paper.txt',
    size: 6,
    lastModified: 42,
    type: 'text/plain',
    source: 'file',
  }]);
  assert.equal(JSON.stringify(task).includes('secret'), false);
});

test('pause and resume are versioned state transitions', () => {
  const created = createTask({prompt: 'Analyze', type: 'analysis'}, fixed);
  const paused = applyAction(created, {action: 'pause', expectedVersion: 1}, fixed);
  const resumed = applyAction(paused, {action: 'resume', expectedVersion: 2}, fixed);

  assert.equal(paused.status, 'paused');
  assert.equal(paused.version, 2);
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.version, 3);
});

test('a stale expectedVersion is rejected without changing the task', () => {
  const created = createTask({prompt: 'Analyze'}, fixed);

  assert.throws(
    () => applyAction(created, {action: 'message', content: 'late', expectedVersion: 0}, fixed),
    error => error instanceof ConflictError && error.currentVersion === 1,
  );
  assert.equal(created.messages.length, 1);
  assert.equal(created.version, 1);
});

test('cancelled tasks reject subsequent actions and completed tasks reject non-message mutations', () => {
  const cancelled = {...createTask({prompt: 'Done'}, fixed), status: 'cancelled'};
  assert.throws(
    () => applyAction(cancelled, {action: 'message', content: 'late', expectedVersion: 1}, fixed),
    /terminal|cancelled/i,
  );
  const completed = {...createTask({prompt: 'Done'}, fixed), status: 'completed'};
  assert.throws(
    () => applyAction(completed, {action: 'pause', expectedVersion: 1}, fixed),
    /terminal|completed/i,
  );
});

test('a message reopens a completed task while retaining prior artifacts and checkpoint', () => {
  const completed = {
    ...createTask({prompt: 'Done'}, fixed),
    status: 'completed',
    artifacts: [{id: 'a', name: 'final.md', mime: 'text/markdown', content: 'old', encoding: 'utf-8', createdAt: fixed.now()}],
    checkpoint: {content: 'previous result'},
  };
  const reopened = applyAction(completed, {action: 'message', content: 'Revise this', expectedVersion: 1}, fixed);

  assert.equal(reopened.status, 'ready');
  assert.equal(reopened.messages.at(-1).content, 'Revise this');
  assert.equal(reopened.artifacts[0].content, 'old');
  assert.equal(reopened.checkpoint.content, 'previous result');
});

test('a new user message supersedes an active execution generation', () => {
  const running = {
    ...createTask({prompt: 'First request'}, fixed),
    status: 'running',
    checkpoint: {executionId: 'run-1', generation: 1, status: 'running'},
  };
  const revised = applyAction(running, {action: 'message', content: 'Revised request', expectedVersion: 1}, fixed);
  assert.equal(revised.status, 'ready');
  assert.equal(revised.checkpoint.status, 'superseded');
  assert.equal(revised.messages.at(-1).content, 'Revised request');
});

test('task plans are bounded, typed, and replaced through the reducer', () => {
  const created = createTask({prompt: 'Review papers', type: 'literature'}, fixed);
  assert.ok(created.plan.length >= 1 && created.plan.length <= 6);
  assert.ok(created.plan.every(item => item.id && item.role && item.label && item.instructions && item.status === 'pending'));

  assert.throws(
    () => applyAction(created, {
      action: 'plan',
      expectedVersion: 1,
      plan: Array.from({length: 7}, (_, index) => ({
        id: `p-${index}`,
        role: 'researcher',
        label: `Step ${index}`,
        status: 'pending',
        instructions: 'Do the step',
      })),
    }, fixed),
    /six|6|plan/i,
  );
});

test('generated artifacts may persist but reject unsupported encodings and missing content', () => {
  const task = createTask({prompt: 'Draft'}, fixed);
  const updated = applyAction(task, {
    action: 'artifact',
    expectedVersion: 1,
    artifact: {name: 'result.md', mime: 'text/markdown', content: '# Result'},
  }, fixed);

  assert.equal(updated.artifacts[0].content, '# Result');
  assert.equal(updated.artifacts[0].encoding, 'utf-8');
  assert.throws(() => applyAction(task, {
    action: 'artifact',
    expectedVersion: 1,
    artifact: {name: 'bad.bin', mime: 'application/octet-stream', content: 'x', encoding: 'rot13'},
  }, fixed), /encoding/i);
});

test('inline artifacts stay below the authenticated HTTP and MCP request budget', () => {
  const task = createTask({prompt: 'Draft'}, fixed);
  assert.throws(() => applyAction(task, {
    action: 'artifact', expectedVersion: 1,
    artifact: {name: 'too-large.txt', mime: 'text/plain', content: 'x'.repeat(500_001)},
  }, fixed), /too long|large/i);
});

test('inline artifact limit measures serialized UTF-8 bytes for Korean content', () => {
  const task = createTask({prompt: 'Draft'}, fixed);
  const accepted = applyAction(task, {
    action: 'artifact', expectedVersion: 1,
    artifact: {name: 'korean.txt', mime: 'text/plain', content: '한'.repeat(160_000)},
  }, fixed);
  assert.equal(accepted.artifacts[0].content.length, 160_000);

  assert.throws(() => applyAction(task, {
    action: 'artifact', expectedVersion: 1,
    artifact: {name: 'korean.txt', mime: 'text/plain', content: '한'.repeat(170_000)},
  }, fixed), /500000|byte|large/i);
});

test('attachments action replaces descriptors, strips bytes, and cannot change a running input set', () => {
  const task = createTask({prompt: 'Analyze'}, fixed);
  const updated = applyAction(task, {
    action: 'attachments',
    expectedVersion: 1,
    attachments: [{
      id: 'new', name: 'new.txt', path: 'new.txt', size: 4, lastModified: 3,
      type: 'text/plain', source: 'file', content: 'source-secret',
    }],
  }, fixed);

  assert.deepEqual(updated.attachments, [{
    id: 'new', name: 'new.txt', path: 'new.txt', size: 4, lastModified: 3,
    type: 'text/plain', source: 'file',
  }]);
  assert.equal(JSON.stringify(updated).includes('source-secret'), false);
  assert.throws(() => applyAction({...task, status: 'running'}, {
    action: 'attachments', expectedVersion: 1, attachments: [],
  }, fixed), /running/i);
});

test('large folders support more than one hundred metadata-only attachment descriptors', () => {
  const attachments = Array.from({length: 101}, (_, index) => ({
    id: `a-${index}`, name: `${index}.txt`, path: `folder/${index}.txt`,
    size: 1, lastModified: 1, type: 'text/plain', source: 'file', content: `secret-${index}`,
  }));
  const task = createTask({prompt: 'Folder review', attachments}, fixed);
  assert.equal(task.attachments.length, 101);
  assert.equal(JSON.stringify(task).includes('secret-'), false);
});

test('presentation and career tasks receive appropriate bounded role plans', () => {
  const presentation = createTask({prompt: 'Make slides', type: 'presentation'}, fixed);
  const career = createTask({prompt: 'Revise CV', type: 'career'}, fixed);
  assert.ok(presentation.plan.some(item => item.role === 'designer'));
  assert.ok(career.plan.some(item => item.role === 'career_editor'));
  assert.ok(presentation.plan.length <= 6 && career.plan.length <= 6);
});
