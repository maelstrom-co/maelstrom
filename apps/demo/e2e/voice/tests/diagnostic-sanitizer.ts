const sensitiveFieldName = `["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|secret|credential|password|client[_-]?secret)["']?\\s*[:=]\\s*`;
const quotedSensitiveField = new RegExp(
  `(${sensitiveFieldName})(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
  'gi',
);
const sensitiveField =
  /(["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|secret|credential|password|client[_-]?secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\s;&}\]]+)/gi;
const authorizationField =
  /(\bauthorization["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\r\n;&}\]]+)/gi;
const basicAuthorization =
  /\b(Basic\s+)(?:"[^"]*"|'[^']*'|[A-Za-z0-9+/]+={0,2})/gi;
const bearerToken = /\b(Bearer\s+)(?:"[^"]*"|'[^']*'|[^\s,;}"'\]]+)/gi;
const providerToken =
  /\b(?:sk|pk|rk|tok)[_-](?:live[_-])?[A-Za-z0-9_-]{8,}\b/gi;
const secretPathSegment =
  /(?:^|[-_.])(?:secret|token|credential|bearer|authorization|api[_-]?key|access[_-]?key)(?:$|[-_.])/i;
const providerPathToken = /^(?:sk|pk|rk|tok)[_-]/i;
const sensitivePathLabel =
  /^(?:token|secret|credential|authorization|auth|grant|grants|session|sessions|api[_-]?key|access[_-]?key)$/i;

export function sanitizeDiagnosticPath(pathname: string): string {
  const segments = pathname.split('/');
  let redactNextSegment = false;
  return segments
    .map((segment) => {
      if (!segment) return segment;
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }
      const redact =
        redactNextSegment ||
        (secretPathSegment.test(decoded) &&
          !sensitivePathLabel.test(decoded)) ||
        providerPathToken.test(decoded) ||
        (decoded.length >= 24 &&
          /[A-Z]/.test(decoded) &&
          /[a-z]/.test(decoded) &&
          /[0-9]/.test(decoded));
      redactNextSegment = sensitivePathLabel.test(decoded);
      return redact ? '[REDACTED]' : segment;
    })
    .join('/');
}

export function sanitizeDiagnosticPathname(urlOrPath: string): string {
  try {
    return sanitizeDiagnosticPath(
      new URL(urlOrPath, 'http://diagnostic.invalid').pathname,
    );
  } catch {
    return '[invalid path]';
  }
}

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(?:https?|wss?):\/\/[^\s?"'<>\])}]+(?:\?[^\s<>]*)?/gi, (url) =>
      sanitizeDiagnosticPathname(url),
    )
    .replace(quotedSensitiveField, '$1"[REDACTED]"')
    .replace(authorizationField, '$1"[REDACTED]"')
    .replace(basicAuthorization, '$1[REDACTED]')
    .replace(bearerToken, '$1[REDACTED]')
    .replace(sensitiveField, '$1"[REDACTED]"')
    .replace(/(?:\/[A-Za-z0-9._~%+-]+)+/g, (path) =>
      sanitizeDiagnosticPathname(path),
    )
    .replace(bearerToken, '$1[REDACTED]')
    .replace(sensitiveField, '$1"[REDACTED]"')
    .replace(providerToken, '[REDACTED]')
    .slice(0, 4_000);
}
