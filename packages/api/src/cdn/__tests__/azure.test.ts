import { initializeAzureBlobService } from '../azure';

jest.mock('@azure/identity', () => {
  throw new Error('Azure identity must not load when Azure storage is unconfigured');
});

describe('optional Azure Blob initialization', () => {
  const originalConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const originalAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  afterAll(() => {
    if (originalConnectionString === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = originalConnectionString;
    if (originalAccountName === undefined) delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    else process.env.AZURE_STORAGE_ACCOUNT_NAME = originalAccountName;
  });

  it('does not import the managed-identity SDK when storage is not configured', async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    await expect(initializeAzureBlobService()).resolves.toBeNull();
  });
});
