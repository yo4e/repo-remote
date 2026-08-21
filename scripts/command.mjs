import fs from 'node:fs';

const SCHEMA_URL = new URL('../schemas/command-v1.schema.json', import.meta.url);
const COMMAND_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_URL, 'utf8'));

const SUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'type',
  'additionalProperties',
  'required',
  'properties',
  'anyOf',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'items',
]);

function assertSupportedSchema(schema, path = '$schema') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`unsupported JSON Schema keyword at ${path}: ${key}`);
    }
  }

  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${path}.properties.${key}`);
    }
  }
  if (schema.items) assertSupportedSchema(schema.items, `${path}.items`);
  if (schema.anyOf) {
    schema.anyOf.forEach((child, index) => assertSupportedSchema(child, `${path}.anyOf[${index}]`));
  }
}

assertSupportedSchema(COMMAND_SCHEMA);

function typeMatches(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  return typeof value === expected;
}

function formatTypes(type) {
  return (Array.isArray(type) ? type : [type]).join(' or ');
}

function validateSchema(value, schema, path = '$') {
  const errors = [];

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !Object.is(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${path} must be ${formatTypes(schema.type)}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be ${schema.maxLength} characters or fewer`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path} has an invalid format`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${path} must not contain duplicate items`);
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
      }
    }
  }

  if (schema.anyOf) {
    const matches = schema.anyOf.some((child) => validateSchema(value, child, path).length === 0);
    if (!matches) errors.push(`${path} must match at least one required command shape`);
  }

  return errors;
}

function normalizeTopic(value) {
  const topic = value.trim().toLowerCase();
  if (!topic) throw new Error('topics may not contain empty values');
  return topic;
}

export function parseCommandPacket(body, owner) {
  let command;
  try {
    command = JSON.parse(body);
  } catch (error) {
    throw new Error(`Issue body must be valid JSON (${error.message})`);
  }

  const schemaErrors = validateSchema(command, COMMAND_SCHEMA);
  if (schemaErrors.length > 0) {
    throw new Error(`command failed JSON Schema validation: ${schemaErrors.slice(0, 3).join('; ')}`);
  }

  let targetOwner = owner;
  let repo = command.repository.trim();
  if (repo.includes('/')) {
    [targetOwner, repo] = repo.split('/');
  }

  if (targetOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`target owner must be ${owner}`);
  }

  if (Object.prototype.hasOwnProperty.call(command, 'homepage') && typeof command.homepage === 'string' && command.homepage.length > 0) {
    let parsed;
    try {
      parsed = new URL(command.homepage);
    } catch {
      throw new Error('homepage must be an absolute http(s) URL, an empty string, or null');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('homepage must use http or https');
    }
  }

  const hasDescription = Object.prototype.hasOwnProperty.call(command, 'description');
  const hasHomepage = Object.prototype.hasOwnProperty.call(command, 'homepage');
  const hasTopics = Object.prototype.hasOwnProperty.call(command, 'topics');
  const topics = hasTopics ? [...new Set(command.topics.map(normalizeTopic))] : undefined;
  const changed = [
    hasDescription && 'description',
    hasHomepage && 'homepage',
    hasTopics && 'topics',
  ].filter(Boolean);

  return {
    command,
    repo,
    target: `${owner}/${repo}`,
    changed,
    topics,
    dryRun: command.dry_run === true,
  };
}
