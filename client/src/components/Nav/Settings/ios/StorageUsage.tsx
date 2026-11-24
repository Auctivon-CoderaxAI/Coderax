import { useGetFiles } from '~/data-provider';
import type { TFile } from 'coderax-data-provider';
import { useLocalize } from '~/hooks';
import { Group, InfoRow } from './Rows';

/** Two decimals past a gigabyte, so a few hundred megabytes still read as a size. */
function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) {
    return `${mb.toFixed(0)} MB`;
  }
  const kb = bytes / 1024;
  if (kb >= 1) {
    return `${kb.toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Totals for the files the account has uploaded. The server keeps no per-user
 * storage quota, so this reports what is used and splits it by kind rather than
 * inventing a denominator.
 */
export default function StorageUsage() {
  const localize = useLocalize();
  const { data: files = [] } = useGetFiles<TFile[]>();

  let total = 0;
  let images = 0;
  for (const file of files) {
    const bytes = Number(file.bytes) || 0;
    total += bytes;
    if (file.type?.startsWith('image/')) {
      images += bytes;
    }
  }
  const documents = total - images;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-primary px-1 text-base font-medium">
        {localize('com_ui_settings_storage_used', { 0: formatSize(total) })}
      </p>
      <Group>
        <InfoRow
          label={localize('com_ui_settings_storage_documents')}
          value={formatSize(documents)}
        />
        <InfoRow label={localize('com_ui_settings_storage_images')} value={formatSize(images)} />
      </Group>
    </div>
  );
}
