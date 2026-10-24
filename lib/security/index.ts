import path from 'path';
import { z } from 'zod';

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // GitHub tokens (classic & fine-grained)
  { pattern: /\b(gh[pousr]_[A-Za-z0-9_]{20,255})\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\b(github_pat_[A-Za-z0-9_]{20,255})\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  // OpenAI & Anthropic keys
  { pattern: /\b(sk-ant-[A-Za-z0-9\-_]{16,255})\b/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { pattern: /\b(sk-(?:proj-|live-|test-)?[A-Za-z0-9\-_]{20,255})\b/g, replacement: '[REDACTED_API_KEY]' },
  // Google API keys
  { pattern: /\b(AIza[0-9A-Za-z\-_]{30,60})\b/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  // AWS Access Key ID
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // Slack tokens
  { pattern: /\b(xox[baprs]-[0-9A-Za-z\-]{10,255})\b/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  // Bearer tokens in headers or CLI arguments
  { pattern: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, replacement: '$1[REDACTED_TOKEN]' },
  // Key-value secrets in CLI args, URLs, or env strings
  {
    pattern: /((?:--|-)?(?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|auth[-_]?token|client[-_]?secret|private[-_]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&;]+)/gi,
    replacement: '$1[REDACTED]',
  },
  // Basic auth in URLs (https://user:pass@host)
  {
    pattern: /(https?:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi,
    replacement: '$1[REDACTED]$3',
  },
  // Private key blocks
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

const SENSITIVE_OBJECT_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'authorization',
  'cookie',
  'set-cookie',
  'credential',
  'credentials',
]);

/**
 * Redacts credentials, tokens, passwords, and API keys from any text string.
 */
export function redactSecrets(input: string | null | undefined): string {
  if (!input) return '';
  let result = String(input);
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Recursively redacts sensitive keys and string values from an arbitrary payload before storage.
 */
export function redactObject<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = k.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_OBJECT_KEYS.has(k.toLowerCase()) || SENSITIVE_OBJECT_KEYS.has(normalizedKey)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactObject(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}

const BLOCKED_PATH_SEGMENTS = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  'AppData\\Local\\Google\\Chrome\\User Data',
  'AppData\\Local\\Microsoft\\Edge\\User Data',
  'AppData\\Roaming\\Mozilla\\Firefox\\Profiles',
  'Windows\\System32\\config',
];

/**
 * Checks whether a file path points to a sensitive configuration or credential file
 * whose raw contents must never be exposed in UI diffs or previews.
 */
export function isSensitiveFilePath(filePath: string): boolean {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  const base = path.basename(normalized).toLowerCase();

  if (base === '.env.example' || base === '.env.template' || base === '.env.sample') {
    return false;
  }
  if (base === '.env' || base.startsWith('.env.')) {
    return true;
  }
  if (
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base.endsWith('.pfx') ||
    base.endsWith('.p12') ||
    base === 'id_rsa' ||
    base === 'id_ed25519' ||
    base === '.npmrc' ||
    base === '.pypirc' ||
    base === '.netrc' ||
    base === 'credentials.json'
  ) {
    return true;
  }
  return false;
}

/**
 * Validates that a filesystem path is safe to inspect locally and does not traverse
 * into restricted OS or credential directories.
 */
export function isSafeLocalPath(targetPath: string, allowedRoots?: string[]): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false;
  if (targetPath.includes('\0')) return false;

  const resolved = path.resolve(targetPath);
  const lowerResolved = resolved.toLowerCase();

  for (const segment of BLOCKED_PATH_SEGMENTS) {
    if (lowerResolved.includes(segment.toLowerCase())) {
      return false;
    }
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const insideAllowed = allowedRoots.some((root) => {
      const resolvedRoot = path.resolve(root).toLowerCase();
      return (
        lowerResolved === resolvedRoot ||
        lowerResolved.startsWith(resolvedRoot + path.sep.toLowerCase())
      );
    });
    if (!insideAllowed) return false;
  }

  return true;
}

/**
 * Verifies that an incoming HTTP request targets localhost by default.
 */
export function isLocalhostOrigin(hostHeader: string | null): boolean {
  if (process.env.DEVSCOPE_ALLOW_REMOTE === 'true') return true;
  if (!hostHeader) return true;
  const hostname = hostHeader.split(':')[0]?.toLowerCase() ?? '';
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

// Runtime validation schemas for API endpoints
export const ProjectRegistrationSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  localPath: z.string().min(1).max(500).trim(),
  githubRepo: z.string().max(200).optional().nullable(),
});

export const ProjectUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).trim().optional(),
  excluded: z.boolean().optional(),
  pinned: z.boolean().optional(),
  githubRepo: z.string().max(200).optional().nullable(),
});

export const ManualTaskSchema = z.object({
  title: z.string().min(1).max(240).trim(),
  description: z.string().max(2000).optional().default(''),
  projectId: z.string().optional().nullable(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown']).default('queued'),
  relevantFiles: z.array(z.string()).optional().default([]),
});

export const TaskUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(240).trim().optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown']).optional(),
});

export const ErrorActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['acknowledge', 'resolve', 'reopen']),
  resolutionNote: z.string().max(1000).optional(),
});

export const ProcessTerminateSchema = z.object({
  pid: z.number().int().positive(),
  confirmPid: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export const MonitoringControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'refresh', 'set_scope']),
  scopePaths: z.array(z.string()).optional(),
});
