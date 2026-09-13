import assert from 'node:assert/strict';
import test from 'node:test';

import { AttachmentSession, MAX_TEXT_BYTES } from '../public/core/attachments.mjs';

function file(name, text, options = {}) {
  const blob = new Blob([text], { type: options.type ?? 'text/plain' });
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: options.lastModified ?? 1, configurable: true },
    webkitRelativePath: { value: options.webkitRelativePath ?? '' },
  });
  return blob;
}

function fileHandle(name, current) {
  return {
    kind: 'file',
    name,
    calls: 0,
    async getFile() {
      this.calls += 1;
      return current.value;
    },
  };
}

function directoryHandle(name, entries) {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* entries;
    },
  };
}

test('file descriptors contain metadata only and reconnecting the same file retains identity', () => {
  const session = new AttachmentSession();
  const original = file('notes.txt', 'private source', { lastModified: 42 });
  const [first] = session.addFiles([original]);
  const [second] = session.addFiles([file('notes.txt', 'private source', { lastModified: 42 })]);

  assert.equal(first.id, second.id);
  assert.deepEqual(Object.keys(first).sort(), ['id', 'lastModified', 'name', 'path', 'size', 'source', 'type']);
  assert.equal(session.list().length, 1);
  assert.equal(JSON.stringify(session.list()).includes('private source'), false);
});

test('malicious relative paths are rejected', () => {
  const session = new AttachmentSession();
  assert.throws(
    () => session.addFiles([file('secret.txt', 'x', { webkitRelativePath: '../secret.txt' })]),
    /unsafe attachment path/i,
  );
  assert.throws(
    () => session.addFiles([file('secret.txt', 'x', { webkitRelativePath: 'C:\\secret.txt' })]),
    /unsafe attachment path/i,
  );
});

test('readText bounds reads at 200000 bytes and reports truncation explicitly', async () => {
  const session = new AttachmentSession();
  const [descriptor] = session.addFiles([file('large.txt', 'a'.repeat(MAX_TEXT_BYTES + 25))]);

  const result = await session.readText(descriptor.id, { maxBytes: MAX_TEXT_BYTES + 1000 });

  assert.equal(result.status, 'truncated');
  assert.equal(result.bytesRead, MAX_TEXT_BYTES);
  assert.equal(new TextEncoder().encode(result.text).length, MAX_TEXT_BYTES);
  assert.equal(result.size, MAX_TEXT_BYTES + 25);
});

test('readText drops an incomplete trailing UTF-8 code point instead of fabricating replacement text', async () => {
  const session = new AttachmentSession();
  const [descriptor] = session.addFiles([file('unicode.txt', 'abc€z')]);

  const result = await session.readText(descriptor.id, { maxBytes: 4 });

  assert.equal(result.status, 'truncated');
  assert.equal(result.bytesRead, 4);
  assert.equal(result.text, 'abc');
  assert.equal(result.text.includes('\uFFFD'), false);
});

test('binary files and URL references are unavailable without hidden network reads', async () => {
  const session = new AttachmentSession();
  const [binary] = session.addFiles([file('scan.h5', 'binary', { type: 'application/x-hdf5' })]);
  const url = session.addUrl('https://example.org/paper?id=1');

  assert.equal((await session.readText(binary.id)).status, 'unavailable');
  assert.equal(await session.getFile(url.id), null);
  assert.deepEqual(await session.readText(url.id), {
    status: 'unavailable', text: '', bytesRead: 0, size: 0,
    reason: 'URL attachments are references and are not fetched automatically.',
  });
  assert.throws(() => session.addUrl('file:///etc/passwd'), /http.*https/i);
  assert.throws(() => session.addUrl('https://user:secret@example.org/paper'), /credentials/i);
});

test('directory traversal preserves nesting and resolves a fresh file on every lookup', async () => {
  const current = { value: file('result.txt', 'first', { lastModified: 7 }) };
  const leaf = fileHandle('result.txt', current);
  const root = directoryHandle('experiment', [directoryHandle('run-01', [leaf])]);
  const session = new AttachmentSession();

  const [descriptor] = await session.addDirectory(root);
  assert.equal(descriptor.path, 'experiment/run-01/result.txt');
  assert.equal((await session.getFile(descriptor.id)).name, 'result.txt');
  assert.equal((await session.getFile(descriptor.id)).name, 'result.txt');
  assert.equal(leaf.calls, 3); // registration plus two live lookups
});

test('changed live file metadata is rejected as stale', async () => {
  const current = { value: file('result.txt', 'first', { lastModified: 7 }) };
  const leaf = fileHandle('result.txt', current);
  const session = new AttachmentSession();
  const [descriptor] = await session.addDirectory(directoryHandle('experiment', [leaf]));
  current.value = file('result.txt', 'changed content', { lastModified: 8 });

  await assert.rejects(session.readText(descriptor.id), /stale attachment/i);
});

test('remove and clear discard memory-only connections', async () => {
  const session = new AttachmentSession();
  const [a, b] = session.addFiles([file('a.txt', 'a'), file('b.txt', 'b')]);
  assert.equal(session.remove(a.id), true);
  await assert.rejects(session.getFile(a.id), /unknown attachment/i);
  session.clear();
  assert.deepEqual(session.list(), []);
  await assert.rejects(session.getFile(b.id), /unknown attachment/i);
});
