import { describe, expect, it } from 'vitest';
import { computeStatus } from '../src/stats';

const today = '2026-10-03';

describe('computeStatus', () => {
  it('status_manual always wins', () => {
    expect(computeStatus({ progress: 100, lastReadAt: today, today, statusManual: 'pausado' })).toBe('pausado');
  });
  it('manual lido wins over low progress', () => {
    expect(computeStatus({ progress: 10, lastReadAt: today, today, statusManual: 'lido' })).toBe('lido');
  });
  it('is lendo just below 95% with a recent session', () => {
    expect(computeStatus({ progress: 94, lastReadAt: today, today, statusManual: null })).toBe('lendo');
  });
  it('is lido from 95% progress', () => {
    expect(computeStatus({ progress: 95, lastReadAt: '2025-01-01', today, statusManual: null })).toBe('lido');
  });
  it('is lendo when read in the last 30 days', () => {
    expect(computeStatus({ progress: 40, lastReadAt: '2026-09-10', today, statusManual: null })).toBe('lendo');
  });
  it('is pausado when not read for more than 30 days', () => {
    expect(computeStatus({ progress: 40, lastReadAt: '2026-08-01', today, statusManual: null })).toBe('pausado');
  });
  it('counts the 30-day window in calendar days', () => {
    expect(computeStatus({ progress: 40, lastReadAt: '2026-09-04', today, statusManual: null })).toBe('lendo');
    expect(computeStatus({ progress: 40, lastReadAt: '2026-09-03', today, statusManual: null })).toBe('pausado');
  });
  it('is pausado when never read', () => {
    expect(computeStatus({ progress: 0, lastReadAt: null, today, statusManual: null })).toBe('pausado');
  });
});
