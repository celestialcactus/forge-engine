import type {
  ApprovalFacts,
  CapabilityCall,
  CapabilityContext,
} from './slice0/contracts.js';

export type ProductApprovalProfile = 'developer' | 'review' | 'locked';

export interface ApprovalConsentRequest {
  readonly schemaVersion: 1;
  readonly profile: 'review';
  readonly call: CapabilityCall;
  readonly context: CapabilityContext;
}

export interface ApprovalConsentResult {
  readonly status: 'granted' | 'declined';
  readonly source: string;
  readonly reason: string;
}

export type ApprovalConsentCallback = (
  request: ApprovalConsentRequest,
  signal: AbortSignal,
) => Promise<ApprovalConsentResult>;

export type ProductApprovalConfiguration =
  | { readonly profile: 'developer' }
  | { readonly profile: 'review'; readonly requestConsent?: ApprovalConsentCallback }
  | { readonly profile: 'locked' };

export interface ProductApprovalFactsProvider {
  collect(
    call: CapabilityCall,
    signal: AbortSignal,
    context: CapabilityContext,
  ): Promise<ApprovalFacts>;
}

export const defaultProductApprovalConfiguration = {
  profile: 'developer',
} as const satisfies ProductApprovalConfiguration;

const profileSource = (profile: ProductApprovalProfile): string =>
  `forge.product.approval-profile.${profile}`;

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('Forge approval was cancelled.');

const raceWithCancellation = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
};

const requiredText = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty.`);
  if (normalized.length > maximum) throw new Error(`${label} must not exceed ${maximum} characters.`);
  return normalized;
};

const normalizeConsentResult = (value: unknown): ApprovalConsentResult => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Approval consent callback must return an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.status !== 'granted' && record.status !== 'declined') {
    throw new Error('Approval consent status must be granted or declined.');
  }
  return {
    status: record.status,
    source: requiredText(record.source, 'Approval consent source', 512),
    reason: requiredText(record.reason, 'Approval consent reason', 4_096),
  };
};

export function parseProductApprovalProfile(raw: string | undefined): ProductApprovalProfile {
  const normalized = raw?.trim().toLowerCase() ?? defaultProductApprovalConfiguration.profile;
  if (normalized === 'developer' || normalized === 'review' || normalized === 'locked') return normalized;
  throw new Error('Approval profile must be developer, review, or locked.');
}

const commonFacts = (
  call: CapabilityCall,
  profile: ProductApprovalProfile,
): Pick<ApprovalFacts, 'schemaVersion' | 'callId' | 'capabilityId'> & { readonly source: string } => ({
  schemaVersion: 1,
  callId: call.id,
  capabilityId: call.capabilityId,
  source: profileSource(profile),
});

export function createProductApprovalFactsProvider(
  configuration: ProductApprovalConfiguration = defaultProductApprovalConfiguration,
): ProductApprovalFactsProvider {
  return {
    async collect(call, signal, context) {
      signal.throwIfAborted();
      const common = commonFacts(call, configuration.profile);
      if (configuration.profile === 'developer') {
        return {
          schemaVersion: common.schemaVersion,
          callId: common.callId,
          capabilityId: common.capabilityId,
          hostPolicy: {
            posture: 'allow',
            source: common.source,
            reason: 'The developer profile permits registered Forge capabilities; governed mutations retain separate exact-change approval.',
          },
          userConsent: {
            status: 'notRequired',
            source: common.source,
            reason: 'This registered capability does not require an additional entry prompt under the developer profile.',
          },
        };
      }
      if (configuration.profile === 'locked') {
        return {
          schemaVersion: common.schemaVersion,
          callId: common.callId,
          capabilityId: common.capabilityId,
          hostPolicy: {
            posture: 'deny',
            source: common.source,
            reason: 'The locked profile denies every model-requested capability call.',
          },
          userConsent: {
            status: 'notRequired',
            source: common.source,
            reason: 'User consent cannot override the locked host posture.',
          },
        };
      }

      const hostPolicy: ApprovalFacts['hostPolicy'] = {
        posture: 'ask',
        source: common.source,
        reason: 'The review profile requires an explicit decision for every model-requested capability call.',
      };
      if (configuration.requestConsent === undefined) {
        return {
          schemaVersion: common.schemaVersion,
          callId: common.callId,
          capabilityId: common.capabilityId,
          hostPolicy,
          userConsent: {
            status: 'unavailable',
            source: common.source,
            reason: 'The host selected review but did not provide a consent callback.',
          },
        };
      }
      const consent = normalizeConsentResult(await raceWithCancellation(configuration.requestConsent({
        schemaVersion: 1,
        profile: 'review',
        call,
        context,
      }, signal), signal));
      signal.throwIfAborted();
      return {
        schemaVersion: common.schemaVersion,
        callId: common.callId,
        capabilityId: common.capabilityId,
        hostPolicy,
        userConsent: {
          status: consent.status,
          source: consent.source,
          reason: consent.reason,
        },
      };
    },
  };
}
