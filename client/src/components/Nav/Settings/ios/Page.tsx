import type { IosPage } from './pages';
import type { SettingsContextValue } from '../types';
import { pageEntries } from './pages';
import { useLocalize } from '~/hooks';
import { TABS } from '../types';
import { Group, SettingRow } from './Rows';

interface EntryGroup {
  key: string;
  label: string;
  entries: ReturnType<typeof pageEntries>;
}

/** Section label for an entry, resolved from the tab metadata the registry uses. */
function sectionLabel(
  tab: string,
  section: string,
  localize: ReturnType<typeof useLocalize>,
): string {
  const tabMeta = TABS.find((meta) => meta.id === tab);
  const sectionMeta = tabMeta?.sections.find((meta) => meta.id === section);
  return sectionMeta != null ? localize(sectionMeta.labelKey) : '';
}

function groupEntries(
  page: IosPage,
  ctx: SettingsContextValue,
  localize: ReturnType<typeof useLocalize>,
): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of pageEntries(page, ctx)) {
    const label = sectionLabel(entry.tab, entry.section, localize);
    /* Entries from different tabs share a heading when they share a section
     * name, so "Danger zone" is one card instead of one per tab. */
    const key = label !== '' ? label : `${entry.tab}:${entry.section}`;
    let group = groups.find((candidate) => candidate.key === key);
    if (group == null) {
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export default function PageContent({ page, ctx }: { page: IosPage; ctx: SettingsContextValue }) {
  const localize = useLocalize();
  const groups = groupEntries(page, ctx, localize);

  const Header = page.header;

  return (
    <div className="flex flex-col gap-5 pb-6">
      {Header != null && <Header />}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label !== '' ? group.label : undefined}>
          {group.label !== '' && (
            <h3 className="text-text-secondary mb-2 px-1 text-xs font-medium tracking-wide uppercase">
              {group.label}
            </h3>
          )}
          <Group>
            {group.entries.map((entry) => {
              const Cmp = entry.Component;
              return (
                <SettingRow key={entry.id}>
                  <div className="w-full">
                    <Cmp />
                  </div>
                </SettingRow>
              );
            })}
          </Group>
        </section>
      ))}
    </div>
  );
}
