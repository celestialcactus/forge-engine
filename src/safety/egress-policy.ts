import type { EgressPolicy } from '../config/schema.js';

/**
 * Egress Policy Enforcer — network-level enforcement for all outbound requests.
 *
 * Every outbound HTTP request is intercepted and checked against this policy
 * before leaving the process. Violations are logged and the request is dropped.
 */
export interface EgressViolation {
  type: 'blocked_domain' | 'unapproved_url' | 'user_api_key' | 'network_denied';
  message: string;
  url?: string;
  domain?: string;
}

export class EgressPolicyEnforcer {
  constructor(private policy: EgressPolicy) {}

  /**
   * Validate an outbound URL against the egress policy.
   */
  validateUrl(url: string): EgressViolation | null {
    // Check network default
    if (this.policy.network_default === 'deny') {
      // Only allowed if URL is in the approved list
      const isApproved = this.policy.allowed_base_urls.some((base) =>
        url.startsWith(base),
      );
      if (!isApproved) {
        // Check if it's a blocked domain specifically
        try {
          const parsedUrl = new URL(url);
          const domain = parsedUrl.hostname;
          if (this.policy.blocked_domains.includes(domain)) {
            return {
              type: 'blocked_domain',
              message: `Domain is explicitly blocked: ${domain}`,
              url,
              domain,
            };
          }
        } catch {
          // Invalid URL
        }

        return {
          type: 'unapproved_url',
          message: `URL is not in the approved list and network_default is deny: ${url}`,
          url,
        };
      }
    }

    // Even in allow mode, check blocked domains
    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;
      if (this.policy.blocked_domains.includes(domain)) {
        return {
          type: 'blocked_domain',
          message: `Domain is explicitly blocked: ${domain}`,
          url,
          domain,
        };
      }
    } catch {
      // Invalid URL
    }

    return null;
  }

  /**
   * Validate that a model provider is approved.
   */
  validateProvider(provider: string): EgressViolation | null {
    if (!this.policy.allowed_model_providers.includes(provider)) {
      return {
        type: 'unapproved_url',
        message: `Model provider is not approved: ${provider}. Approved: [${this.policy.allowed_model_providers.join(', ')}]`,
      };
    }
    return null;
  }

  /**
   * Check if user API keys are being used when disallowed.
   */
  validateNoUserApiKey(headers: Record<string, string>): EgressViolation | null {
    if (!this.policy.disallow_user_api_keys) return null;

    // Check common API key headers
    const keyHeaders = [
      'authorization',
      'x-api-key',
      'api-key',
      'openai-api-key',
      'anthropic-api-key',
    ];
    for (const header of keyHeaders) {
      if (headers[header.toLowerCase()]) {
        return {
          type: 'user_api_key',
          message: `User API key detected in header "${header}" but user API keys are disabled`,
        };
      }
    }

    return null;
  }
}
