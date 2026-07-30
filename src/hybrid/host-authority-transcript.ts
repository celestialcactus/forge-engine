import { sign, type KeyLike } from 'node:crypto';

export type HostIsolationControl =
  | 'process'
  | 'filesystem'
  | 'network'
  | 'credentials'
  | 'resources';

export interface HostIsolationChallenge {
  readonly schemaVersion: 1;
  readonly challengeId: string;
  readonly nonceHex: string;
  readonly issuedAtUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly providerId: string;
  readonly capabilityDigest: string;
  readonly policyDigest: string;
  readonly requiredControls: readonly HostIsolationControl[];
}

export interface HostBoundaryStatement {
  readonly challengeId: string;
  readonly keyId: string;
  readonly boundaryId: string;
  readonly processBoundaryInherited: boolean;
  readonly attestedControls: readonly HostIsolationControl[];
}

export interface SignedHostBoundaryStatement {
  readonly statement: HostBoundaryStatement;
  readonly signatureHex: string;
}

const transcriptDomain = Buffer.from('forge.host-isolation.attestation.v1\0', 'ascii');
const identifier = /^[A-Za-z0-9._:-]{1,128}$/u;
const digest = /^[0-9A-Fa-f]{64}$/u;
const controlCodes: Readonly<Record<HostIsolationControl, number>> = {
  process: 1,
  filesystem: 2,
  network: 3,
  credentials: 4,
  resources: 5,
};

const boundedField = (value: Uint8Array): Buffer => {
  if (value.byteLength > 0xffff_ffff) throw new Error('Host transcript field is too large.');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.byteLength);
  return Buffer.concat([length, value]);
};

const uint64 = (value: number): Buffer => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Host transcript timestamp is not a safe unsigned integer.');
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
};

const hex32 = (label: string, value: string): Buffer => {
  if (!digest.test(value)) throw new Error(label + ' must be exactly 32 hexadecimal bytes.');
  return Buffer.from(value, 'hex');
};

const canonicalControlBytes = (controls: readonly HostIsolationControl[]): Buffer => {
  if (controls.length === 0 || controls.length > 5) {
    throw new Error('Host isolation controls must contain 1 to 5 entries.');
  }
  const codes = controls.map((control) => controlCodes[control]).sort((left, right) => left - right);
  if (codes.some((code) => code === undefined) || new Set(codes).size !== codes.length) {
    throw new Error('Host isolation controls are invalid or duplicated.');
  }
  return Buffer.from([codes.length, ...codes]);
};

const checkedIdentifier = (label: string, value: string): Buffer => {
  if (!identifier.test(value)) throw new Error(label + ' is invalid.');
  return Buffer.from(value, 'ascii');
};

export const hostAttestationSigningBytes = (
  challenge: HostIsolationChallenge,
  statement: HostBoundaryStatement,
): Buffer => {
  if (challenge.schemaVersion !== 1) throw new Error('Unsupported host challenge schema version.');
  if (statement.challengeId !== challenge.challengeId) {
    throw new Error('Host statement challenge ID does not match the challenge.');
  }
  const nonce = hex32('Host challenge nonce', challenge.nonceHex);
  return Buffer.concat([
    transcriptDomain,
    Buffer.from([challenge.schemaVersion]),
    boundedField(checkedIdentifier('Host challenge ID', challenge.challengeId)),
    boundedField(nonce),
    uint64(challenge.issuedAtUnixMs),
    uint64(challenge.expiresAtUnixMs),
    boundedField(checkedIdentifier('Host provider ID', challenge.providerId)),
    boundedField(hex32('Capability digest', challenge.capabilityDigest)),
    boundedField(hex32('Policy digest', challenge.policyDigest)),
    canonicalControlBytes(challenge.requiredControls),
    boundedField(checkedIdentifier('Host statement challenge ID', statement.challengeId)),
    boundedField(checkedIdentifier('Host key ID', statement.keyId)),
    boundedField(checkedIdentifier('Host boundary ID', statement.boundaryId)),
    Buffer.from([statement.processBoundaryInherited ? 1 : 0]),
    canonicalControlBytes(statement.attestedControls),
  ]);
};

export const signHostBoundaryStatement = (
  challenge: HostIsolationChallenge,
  statement: HostBoundaryStatement,
  privateKey: KeyLike,
): SignedHostBoundaryStatement => ({
  statement,
  signatureHex: sign(null, hostAttestationSigningBytes(challenge, statement), privateKey)
    .toString('hex'),
});