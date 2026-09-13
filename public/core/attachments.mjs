export const MAX_TEXT_BYTES = 200_000;

const TEXT_EXTENSIONS = new Set([
  'csv', 'json', 'jsonl', 'log', 'md', 'markdown', 'mjs', 'js', 'py', 'rst',
  'text', 'toml', 'tsv', 'txt', 'xml', 'yaml', 'yml',
]);

function safePath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new TypeError('Unsafe attachment path.');
  }
  const path = input.replaceAll('\\', '/');
  const parts = path.split('/');
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`Unsafe attachment path: ${input}`);
  }
  return parts.join('/');
}

function fileMetadata(file, path, source) {
  if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') {
    throw new TypeError('Attachment must be a browser File or File-like object.');
  }
  const cleanPath = safePath(path);
  const name = safePath(file.name);
  if (name.includes('/')) throw new TypeError(`Unsafe attachment path: ${file.name}`);
  return {
    name,
    path: cleanPath,
    size: file.size,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0,
    type: typeof file.type === 'string' ? file.type : '',
    source,
  };
}

function fingerprint(metadata) {
  return [metadata.source, metadata.path, metadata.size, metadata.lastModified, metadata.type, metadata.url ?? ''].join('\u001f');
}

function stableId(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `att_${(hash >>> 0).toString(36)}`;
}

function copyDescriptor(descriptor) {
  return { ...descriptor };
}

function assertSameFile(file, descriptor) {
  if (
    file.name !== descriptor.name
    || file.size !== descriptor.size
    || (Number.isFinite(file.lastModified) ? file.lastModified : 0) !== descriptor.lastModified
    || (typeof file.type === 'string' ? file.type : '') !== descriptor.type
  ) {
    throw new Error(`Stale attachment: ${descriptor.path} changed after it was connected.`);
  }
}

function isTextFile(descriptor) {
  if (descriptor.type.startsWith('text/')) return true;
  if (/^(application\/(json|ld\+json|xml|x-ndjson|javascript))$/i.test(descriptor.type)) return true;
  const dot = descriptor.name.lastIndexOf('.');
  return dot >= 0 && TEXT_EXTENSIONS.has(descriptor.name.slice(dot + 1).toLowerCase());
}

export class AttachmentSession {
  #entries = new Map();

  addFiles(files) {
    if (!files || typeof files[Symbol.iterator] !== 'function') {
      throw new TypeError('files must be iterable.');
    }
    const added = [];
    for (const file of files) {
      const relativePath = file.webkitRelativePath || file.name;
      const source = file.webkitRelativePath ? 'folder' : 'file';
      const metadata = fileMetadata(file, relativePath, source);
      added.push(this.#put(metadata, async () => file));
    }
    return added;
  }

  async addDirectory(handle) {
    if (!handle || handle.kind !== 'directory' || typeof handle.values !== 'function') {
      throw new TypeError('A browser directory handle is required.');
    }
    const root = safePath(handle.name);
    const added = [];
    const visit = async (directory, parentPath) => {
      for await (const entry of directory.values()) {
        if (!entry || (entry.kind !== 'file' && entry.kind !== 'directory')) continue;
        const entryPath = safePath(`${parentPath}/${entry.name}`);
        if (entry.kind === 'directory') {
          await visit(entry, entryPath);
          continue;
        }
        if (typeof entry.getFile !== 'function') {
          throw new TypeError(`File handle cannot be read: ${entryPath}`);
        }
        const file = await entry.getFile();
        const metadata = fileMetadata(file, entryPath, 'folder');
        added.push(this.#put(metadata, () => entry.getFile()));
      }
    };
    await visit(handle, root);
    return added;
  }

  addUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new TypeError('Attachment URL must use http or https.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError('Attachment URL must use http or https.');
    }
    if (url.username || url.password) {
      throw new TypeError('Attachment URL must not contain credentials.');
    }
    url.hash = '';
    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
    let decodedName = '';
    try { decodedName = lastSegment ? decodeURIComponent(lastSegment) : ''; } catch { decodedName = ''; }
    const unsafeName = decodedName || url.hostname;
    const name = unsafeName.replaceAll('/', '_').replaceAll('\\', '_') || 'link';
    const metadata = {
      name,
      path: url.href,
      size: 0,
      lastModified: 0,
      type: 'text/uri-list',
      source: 'url',
      url: url.href,
    };
    return this.#put(metadata, null);
  }

  list() {
    return [...this.#entries.values()].map(({ descriptor }) => copyDescriptor(descriptor));
  }

  remove(id) {
    return this.#entries.delete(id);
  }

  clear() {
    this.#entries.clear();
  }

  async getFile(id) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`Unknown attachment: ${id}`);
    if (!entry.resolveFile) return null;
    const file = await entry.resolveFile();
    assertSameFile(file, entry.descriptor);
    return file;
  }

  async readText(id, { maxBytes = MAX_TEXT_BYTES } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive integer.');
    }
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`Unknown attachment: ${id}`);
    if (entry.descriptor.source === 'url') {
      return {
        status: 'unavailable', text: '', bytesRead: 0, size: 0,
        reason: 'URL attachments are references and are not fetched automatically.',
      };
    }
    if (!isTextFile(entry.descriptor)) {
      return {
        status: 'unavailable', text: '', bytesRead: 0, size: entry.descriptor.size,
        reason: 'This file type is not available for text extraction.',
      };
    }
    const file = await this.getFile(id);
    const limit = Math.min(maxBytes, MAX_TEXT_BYTES);
    const slice = file.slice(0, limit);
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const truncated = file.size > limit;
    return {
      status: truncated ? 'truncated' : 'available',
      text: new TextDecoder('utf-8').decode(bytes, { stream: truncated }),
      bytesRead: bytes.byteLength,
      size: file.size,
    };
  }

  #put(metadata, resolveFile) {
    const key = fingerprint(metadata);
    let id = stableId(key);
    let suffix = 1;
    while (this.#entries.has(id) && this.#entries.get(id).key !== key) {
      id = `${stableId(key)}_${suffix}`;
      suffix += 1;
    }
    const descriptor = Object.freeze({ id, ...metadata });
    this.#entries.set(id, { key, descriptor, resolveFile });
    return copyDescriptor(descriptor);
  }
}
