import { describe, expect, it } from 'vitest';
import {
  decryptJsonFromVault,
  deleteTenantVault,
  encryptJsonForVault,
  loadTenantVaultSync,
  saveTenantVaultSync,
} from '../server/tokenVault';
import {
  isStravaOriginRecord,
  sanitizeTelemetryForCleanRoom,
} from '../server/cleanRoomFirewall';
import { isPrivateOrReservedIp, isSafeExternalUrl } from '../server/securityUtils';

describe('AES-256-GCM Multi-Tenant Token Vault & Strava Clean-Room Firewall', () => {
  it('encrypts secrets with AES-256-GCM and rejects tampered ciphertext or authTag', () => {
    const secretPayload = {
      garminPersonalApiKey: 'GCDC_secret_12345',
      stravaRefreshToken: 'rt_987654321',
    };
    const envelope = encryptJsonForVault(secretPayload);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain('GCDC_secret_12345');
    expect(envelope).not.toContain('rt_987654321');

    const decrypted = decryptJsonFromVault<typeof secretPayload>(envelope);
    expect(decrypted).toEqual(secretPayload);

    // Flip 1 character in ciphertext -> GCM authTag verification must reject (return null)
    const tampered =
      envelope.slice(0, -2) + (envelope.endsWith('A') ? 'B' : 'A') + envelope.slice(-1);
    expect(decryptJsonFromVault(tampered)).toBeNull();
  });

  it('strictly isolates tenant A and tenant B vaults on disk and cleans up on delete', async () => {
    const tenantA = `vitest_tenant_a_${Date.now()}`;
    const tenantB = `vitest_tenant_b_${Date.now()}`;

    saveTenantVaultSync(tenantA, { geminiApiKey: 'AIza_TENANT_A_ONLY' });
    saveTenantVaultSync(tenantB, { geminiApiKey: '' });

    expect(loadTenantVaultSync(tenantA, { geminiApiKey: '' }).geminiApiKey).toBe(
      'AIza_TENANT_A_ONLY'
    );
    expect(loadTenantVaultSync(tenantB, { geminiApiKey: '' }).geminiApiKey).toBe('');

    await deleteTenantVault(tenantA);
    await deleteTenantVault(tenantB);
    expect(loadTenantVaultSync(tenantA, { geminiApiKey: 'empty' }).geminiApiKey).toBe('empty');
  });

  it('strips Strava-only activities while preserving Garmin/FIT telemetry in Clean-Room Firewall', () => {
    const garminRide = {
      id: 'garmin-101',
      name: 'Garmin Edge Threshold Ride',
      sourceBadges: ['Garmin'],
      load: 92,
    };
    const dualMergedRide = {
      id: 'garmin-102',
      stravaId: '998877',
      name: 'Dual Garmin + Strava Ride',
      sourceBadges: ['Garmin', 'Strava'],
      load: 75,
    };
    const stravaOnlyRun = {
      id: 'strava-555',
      stravaId: '555',
      name: 'Strava-Only Morning Run',
      sourceBadges: ['Strava'],
      load: 48,
    };

    expect(isStravaOriginRecord(garminRide)).toBe(false);
    expect(isStravaOriginRecord(dualMergedRide)).toBe(false);
    expect(isStravaOriginRecord(stravaOnlyRun)).toBe(true);

    const sanitized = sanitizeTelemetryForCleanRoom({
      recentActivities: [garminRide, dualMergedRide, stravaOnlyRun],
      stravaSegments: [{ id: 'seg-1' }],
      stravaKudos: 14,
      latestWellness: { hrvRMSSD: 64, sleepScore: 86 },
    });

    expect(sanitized.recentActivities).toHaveLength(2);
    expect(sanitized.stravaRecordsFiltered).toBe(1);
    expect(sanitized.stravaSegments).toBeUndefined();
    expect(sanitized.stravaKudos).toBeUndefined();
    expect(sanitized.cleanRoomPolicy).toBe('FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY');
  });

  it('blocks private, loopback, link-local, and IPv4-mapped IPv6 SSRF targets', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('10.24.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);

    expect(isSafeExternalUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeExternalUrl('https://www.tfrrs.org/results/12345')).toBe(true);
  });
});
