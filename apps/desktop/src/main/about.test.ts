import { describe, expect, it } from 'vitest';

import { aboutDetail, aboutPanelOptions, COPYRIGHT } from './about';

describe('aboutPanelOptions', () => {
  it('shows the app version under the product name', () => {
    expect(aboutPanelOptions('1.2.3')).toEqual({
      applicationName: 'Reprise',
      applicationVersion: '1.2.3',
      copyright: COPYRIGHT,
    });
  });
});

describe('aboutDetail', () => {
  it('lists the app version, then the runtime versions', () => {
    expect(aboutDetail('1.0.0-rc.1', { electron: '45.2.2', chrome: '140.0', node: '24.1.0' })).toBe(
      `Version 1.0.0-rc.1\nElectron 45.2.2\nChromium 140.0\nNode.js 24.1.0\n\n${COPYRIGHT}`,
    );
  });

  it('leaves out a runtime version the process does not report', () => {
    expect(aboutDetail('0.0.0', { electron: '45.2.2' })).toBe(
      `Version 0.0.0\nElectron 45.2.2\n\n${COPYRIGHT}`,
    );
  });
});
