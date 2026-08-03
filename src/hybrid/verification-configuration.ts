import type { HostIsolationControl } from './host-authority-transcript.js';

export type VerificationIsolationProfile = 'trusted' | 'host_managed' | 'restricted';

export interface VerificationIsolationPolicyConfiguration {
  readonly profile: VerificationIsolationProfile;
  readonly requiredControls?: readonly HostIsolationControl[];
  readonly allowedHostProviderIds?: readonly string[];
}

export interface VerificationCheckConfiguration {
  readonly checkId: string;
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly environment?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly inheritEnvironment?: readonly string[];
  readonly isolationPolicy?: VerificationIsolationPolicyConfiguration;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type TrustedVerificationCheckConfiguration = VerificationCheckConfiguration;
