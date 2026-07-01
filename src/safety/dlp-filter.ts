/**
 * DLP (Data Loss Prevention) Filter
 *
 * Intercepts all outbound LLM requests and redacts secrets, PII,
 * and proprietary patterns. Runs BEFORE egress policy — content
 * is cleaned before the destination is even evaluated.
 */

export interface DlpRedaction {
  type: 'secret' | 'pii' | 'custom';
  pattern: string;
  replacement: string;
  matchCount: number;
}

// Common secret patterns
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'AWS Secret Key',
    regex: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}/g,
    replacement: '[REDACTED_AWS_SECRET]',
  },
  {
    name: 'GitHub Token',
    regex: /gh[ps]_[A-Za-z0-9_]{36,}/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'Generic API Key',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*["']?[A-Za-z0-9\-_.]{20,}["']?/gi,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'Bearer Token',
    regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    name: 'Connection String',
    regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/g,
    replacement: '[REDACTED_CONNECTION_STRING]',
  },
  {
    name: 'JWT Token',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
    replacement: '[REDACTED_JWT]',
  },
];

export class DlpFilter {
  private customPatterns: Array<{ name: string; regex: RegExp; replacement: string }>;

  constructor(customPatterns?: Array<{ pattern: string; replacement: string }>) {
    this.customPatterns = (customPatterns || []).map((p, i) => ({
      name: `Custom Pattern ${i + 1}`,
      regex: new RegExp(p.pattern, 'g'),
      replacement: p.replacement,
    }));
  }

  /**
   * Redact secrets and sensitive patterns from content.
   * Returns the cleaned content and a list of redactions made.
   */
  redact(content: string): { cleaned: string; redactions: DlpRedaction[] } {
    let cleaned = content;
    const redactions: DlpRedaction[] = [];

    // Apply built-in patterns
    for (const pattern of SECRET_PATTERNS) {
      const matches = cleaned.match(pattern.regex);
      if (matches && matches.length > 0) {
        redactions.push({
          type: 'secret',
          pattern: pattern.name,
          replacement: pattern.replacement,
          matchCount: matches.length,
        });
        cleaned = cleaned.replace(pattern.regex, pattern.replacement);
      }
    }

    // Apply custom patterns
    for (const pattern of this.customPatterns) {
      const matches = cleaned.match(pattern.regex);
      if (matches && matches.length > 0) {
        redactions.push({
          type: 'custom',
          pattern: pattern.name,
          replacement: pattern.replacement,
          matchCount: matches.length,
        });
        cleaned = cleaned.replace(pattern.regex, pattern.replacement);
      }
    }

    return { cleaned, redactions };
  }

  /**
   * Check if content contains any secrets (without redacting).
   */
  containsSecrets(content: string): boolean {
    for (const pattern of [...SECRET_PATTERNS, ...this.customPatterns]) {
      if (pattern.regex.test(content)) {
        // Reset lastIndex since we used 'g' flag
        pattern.regex.lastIndex = 0;
        return true;
      }
    }
    return false;
  }
}
