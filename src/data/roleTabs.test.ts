import { describe, expect, it } from 'vitest';
import { ROLE_TABS } from './mockData';

describe('which tabs each role gets', () => {
  it('keeps Fuel Expenses and Monthly Expenses away from Drivers', () => {
    expect(ROLE_TABS.Driver).not.toContain('fuel');
    expect(ROLE_TABS.Driver).not.toContain('expenses');
    expect(ROLE_TABS.Driver).toEqual(['addtrip', 'movements', 'triplog', 'settings', 'help']);
  });

  it('gives Fuel Expenses to the Manager only', () => {
    expect(ROLE_TABS.Manager).toContain('fuel');
    expect(ROLE_TABS.Office).not.toContain('fuel');
  });

  it('gives Monthly Report to Office', () => {
    expect(ROLE_TABS.Office).toContain('report');
  });

  it('limits a Viewer to the three read-only reports (plus Settings and Help)', () => {
    expect(ROLE_TABS.Viewer).toEqual(['dashboard', 'summary', 'report', 'settings', 'help']);
  });

  it('keeps every role landing on the same first screen as before', () => {
    expect(ROLE_TABS.Driver[0]).toBe('addtrip');
    expect(ROLE_TABS.Office[0]).toBe('addtrip');
    expect(ROLE_TABS.Manager[0]).toBe('dashboard');
    expect(ROLE_TABS.Viewer[0]).toBe('dashboard');
  });
});
