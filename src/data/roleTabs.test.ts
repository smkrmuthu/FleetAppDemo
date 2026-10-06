import { describe, expect, it } from 'vitest';
import { ROLE_TABS } from './mockData';

describe('which tabs each role gets', () => {
  it('keeps Fuel Expenses and Monthly Expenses away from Drivers', () => {
    expect(ROLE_TABS.Driver).not.toContain('fuel');
    expect(ROLE_TABS.Driver).not.toContain('expenses');
    expect(ROLE_TABS.Driver).toEqual(['addtrip', 'triplog']);
  });

  it('gives Fuel Expenses to the Manager only', () => {
    expect(ROLE_TABS.Manager).toContain('fuel');
    expect(ROLE_TABS.Office).not.toContain('fuel');
  });

  it('gives Monthly Report to Office', () => {
    expect(ROLE_TABS.Office).toContain('report');
  });

  it('limits a Viewer to the three read-only reports', () => {
    expect(ROLE_TABS.Viewer).toEqual(['dashboard', 'summary', 'report']);
  });
});
