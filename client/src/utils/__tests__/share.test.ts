jest.mock('coderax-data-provider', () => ({
  apiBaseUrl: jest.fn(),
}));

import { apiBaseUrl } from 'coderax-data-provider';
import { buildShareLinkUrl } from '../share';

describe('buildShareLinkUrl', () => {
  it('includes the base path for subdirectory deployments', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/coderax');
    expect(buildShareLinkUrl('reW8SsFGQEH1b1uzSHe4I')).toBe(
      'http://localhost:3080/coderax/share/reW8SsFGQEH1b1uzSHe4I',
    );
  });

  it('works when base path is root', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('');
    expect(buildShareLinkUrl('reW8SsFGQEH1b1uzSHe4I')).toBe(
      'http://localhost:3080/share/reW8SsFGQEH1b1uzSHe4I',
    );
  });
});
