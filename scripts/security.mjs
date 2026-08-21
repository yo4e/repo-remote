export function redactSecrets(value, secrets = []) {
  let safe = String(value ?? '');

  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[REDACTED]');
  }

  safe = safe
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAuthorization\s*:\s*[^\r\n]+/gi, 'Authorization: [REDACTED]');

  return safe.slice(0, 2000);
}
