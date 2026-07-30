import assert from 'node:assert/strict';
import { createHash, createPrivateKey, verify } from 'node:crypto';
import { test } from 'node:test';
import {
  hostAttestationSigningBytes,
  signHostBoundaryStatement,
  type HostBoundaryStatement,
  type HostIsolationChallenge,
} from '../src/hybrid/host-authority-transcript.js';

const challenge: HostIsolationChallenge = {
  schemaVersion: 1,
  challengeId: 'host-challenge:15df218011a72c63d997484bd87643a32aa6d33513f0444b714ce53e49f596b2',
  nonceHex: '03'.repeat(32),
  issuedAtUnixMs: 1_000,
  expiresAtUnixMs: 11_000,
  providerId: 'host.fixture',
  capabilityDigest: '11'.repeat(32),
  policyDigest: '22'.repeat(32),
  requiredControls: ['process', 'filesystem'],
};

const statement: HostBoundaryStatement = {
  challengeId: challenge.challengeId,
  keyId: 'key.primary',
  boundaryId: 'boundary.fixture',
  processBoundaryInherited: true,
  attestedControls: ['filesystem', 'process'],
};

test('TypeScript reproduces the Rust host-attestation golden transcript', () => {
  const bytes = hostAttestationSigningBytes(challenge, statement);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '7e50244a2fb368d15c0d1c3dc726fec298746fcf682df529c7fe4337f73a9bc5',
  );
});

test('host signing helper emits a strict Ed25519 signature over the bound transcript', () => {
  const seed = Buffer.alloc(32, 7);
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const signed = signHostBoundaryStatement(challenge, statement, privateKey);
  assert.equal(signed.signatureHex.length, 128);
  assert.equal(
    verify(
      null,
      hostAttestationSigningBytes(challenge, statement),
      privateKey,
      Buffer.from(signed.signatureHex, 'hex'),
    ),
    true,
  );
});