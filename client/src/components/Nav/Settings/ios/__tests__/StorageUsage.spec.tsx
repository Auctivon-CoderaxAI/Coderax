import { render, screen } from '@testing-library/react';
import type { TFile } from 'coderax-data-provider';
import StorageUsage from '../StorageUsage';

const mockFiles: TFile[] = [];

jest.mock('~/data-provider', () => ({
  useGetFiles: () => ({ data: mockFiles }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options?.['0'] != null ? `${key}: ${options['0']}` : key,
}));

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const file = (bytes: number, type?: string): TFile => ({ bytes, type }) as TFile;

function withFiles(files: TFile[]) {
  mockFiles.length = 0;
  mockFiles.push(...files);
  render(<StorageUsage />);
}

describe('iOS storage usage', () => {
  it('splits uploaded bytes into documents and images under the used total', () => {
    withFiles([file(1.5 * GIB, 'image/png'), file(512 * MIB, 'application/pdf')]);
    expect(screen.getByText('com_ui_settings_storage_used: 2.00 GB')).toBeInTheDocument();
    expect(screen.getByText('com_ui_settings_storage_documents')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText('com_ui_settings_storage_images')).toBeInTheDocument();
    expect(screen.getByText('1.50 GB')).toBeInTheDocument();
  });

  it('counts a file without a mime type as a document', () => {
    withFiles([file(MIB)]);
    expect(screen.getByText('1 MB')).toBeInTheDocument();
    expect(screen.getByText('0 B')).toBeInTheDocument();
  });

  it('reports zero for an account with no uploads', () => {
    withFiles([]);
    expect(screen.getByText('com_ui_settings_storage_used: 0 B')).toBeInTheDocument();
    expect(screen.getAllByText('0 B')).toHaveLength(2);
  });

  it('reads sizes below a megabyte in kilobytes', () => {
    withFiles([file(512 * 1024, 'text/plain')]);
    expect(screen.getByText('com_ui_settings_storage_used: 512 KB')).toBeInTheDocument();
    expect(screen.getByText('512 KB')).toBeInTheDocument();
  });
});
