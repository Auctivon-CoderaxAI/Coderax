// client/src/hooks/Nav/__tests__/useSideNavLinks.spec.tsx
import { renderHook } from '@testing-library/react';
import { PermissionTypes, Permissions } from 'coderax-data-provider';
import type { TEndpointsConfig } from 'coderax-data-provider';
import useSideNavLinks from '../useSideNavLinks';

/**
 * useSideNavLinks registers a panel only when useHasAccess grants the matching
 * permission(s). Each test grants a set of "<type>:<permission>" keys and checks
 * which link ids are produced.
 */
let mockGranted = new Set<string>();
let mockMCPServers: unknown[] = [];

jest.mock('~/hooks', () => ({
  useHasAccess: ({ permissionType, permission }: { permissionType: string; permission: string }) =>
    mockGranted.has(`${permissionType}:${permission}`),
  useMCPServerManager: () => ({ availableMCPServers: mockMCPServers }),
  useGetAgentsConfig: () => ({ agentsConfig: undefined }),
  useAgentCapabilities: () => ({ skillsEnabled: false }),
}));

jest.mock('@coderax/client', () => ({ MCPIcon: () => null, OpenAIMinimalIcon: () => null }));
jest.mock('~/components/SidePanel/MCPBuilder/MCPBuilderPanel', () => () => null);
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Bookmarks/BookmarkPanel', () => () => null);
jest.mock('~/components/SidePanel/Builder/PanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Schedules', () => ({ SchedulePanel: () => null }));
jest.mock('~/components/SidePanel/Parameters/Panel', () => () => null);
jest.mock('~/components/SidePanel/Memories', () => ({ MemoryPanel: () => null }));
jest.mock('~/components/Prompts', () => ({ PromptsAccordion: () => null }));
jest.mock('~/components/Skills', () => ({ SkillsAccordion: () => null }));

const key = (type: PermissionTypes, permission: Permissions) => `${type}:${permission}`;

const renderLinks = (
  interfaceConfig: Record<string, unknown> = {},
  extra: { hidePanel?: () => void } = {},
) =>
  renderHook(() =>
    useSideNavLinks({
      keyProvided: false,
      interfaceConfig,
      endpointsConfig: {} as TEndpointsConfig,
      ...extra,
    }),
  ).result.current.map((link) => link.id);

describe('useSideNavLinks access gating', () => {
  beforeEach(() => {
    mockGranted = new Set();
    mockMCPServers = [];
  });

  it('registers no gated panels without any permission', () => {
    expect(renderLinks()).toEqual([]);
  });

  it('gates prompts and bookmarks on USE', () => {
    mockGranted.add(key(PermissionTypes.PROMPTS, Permissions.USE));
    mockGranted.add(key(PermissionTypes.BOOKMARKS, Permissions.USE));
    expect(renderLinks()).toEqual(['prompts', 'bookmarks']);
  });

  it('requires both USE and READ for memories', () => {
    mockGranted.add(key(PermissionTypes.MEMORIES, Permissions.USE));
    expect(renderLinks()).not.toContain('memories');

    mockGranted.add(key(PermissionTypes.MEMORIES, Permissions.READ));
    expect(renderLinks()).toContain('memories');
  });

  it('shows the MCP builder with CREATE even when no servers exist', () => {
    mockGranted.add(key(PermissionTypes.MCP_SERVERS, Permissions.CREATE));
    expect(renderLinks()).toContain('mcp-builder');
  });

  it('shows the MCP builder with USE only when servers are available', () => {
    mockGranted.add(key(PermissionTypes.MCP_SERVERS, Permissions.USE));
    expect(renderLinks()).not.toContain('mcp-builder');

    mockMCPServers = [{ serverName: 'local' }];
    expect(renderLinks()).toContain('mcp-builder');
  });

  it.each([
    [undefined, false],
    [false, false],
    [true, true],
    [{ use: false }, false],
    [{}, true],
  ])('schedules config %p with access -> shown: %p', (schedules, shown) => {
    mockGranted.add(key(PermissionTypes.SCHEDULES, Permissions.USE));
    expect(renderLinks({ schedules }).includes('schedules')).toBe(shown);
  });

  it('hides schedules without access even when enabled', () => {
    expect(renderLinks({ schedules: true })).not.toContain('schedules');
  });

  it('appends hide-panel last when a handler is given', () => {
    mockGranted.add(key(PermissionTypes.PROMPTS, Permissions.USE));
    const ids = renderLinks({}, { hidePanel: jest.fn() });
    expect(ids[ids.length - 1]).toBe('hide-panel');
  });
});
