export const MAX_COMMAND_BYTES = 128 * 1024;
export const MAX_JSON_DEPTH = 16;
export const MAX_JSON_NODES = 512;

export function assertCommandBodySize(body) {
  if (typeof body !== 'string') throw new Error('Issue body must be a string');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_COMMAND_BYTES) {
    throw new Error(`command payload exceeds the safe limit of ${MAX_COMMAND_BYTES} UTF-8 bytes`);
  }
  return bytes;
}

export function assertJsonComplexity(value) {
  const stack = [{ value, depth: 1 }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;

    if (nodes > MAX_JSON_NODES) {
      throw new Error(`command JSON exceeds the safe node limit of ${MAX_JSON_NODES}`);
    }
    if (current.depth > MAX_JSON_DEPTH) {
      throw new Error(`command JSON exceeds the safe depth limit of ${MAX_JSON_DEPTH}`);
    }

    const item = current.value;
    if (item === null || typeof item !== 'object') continue;

    const children = Array.isArray(item) ? item : Object.values(item);
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  return nodes;
}
