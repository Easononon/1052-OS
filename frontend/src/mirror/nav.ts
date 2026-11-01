import {
  IconBell,
  IconCalendar,
  IconChat,
  IconDatabase,
  IconLoad,
  IconMemory,
  IconNotes,
  IconOrchestration,
  IconRepo,
  IconResources,
  IconSearchGrid,
  IconServer,
  IconSettings,
  IconSkills,
  IconSocial,
  IconSparkle,
  IconToolbox,
  IconVariable,
  IconWiki,
  IconShell,
  IconSqlFile,
} from '../components/Icons'

type IconComponent = (p: { size?: number; className?: string }) => JSX.Element

export interface NavItem {
  id: string
  label: string
  path: string
  Icon: IconComponent
}

export interface NavSection extends NavItem {
  items: ReadonlyArray<NavItem>
}

export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    id: 'today',
    label: '今日',
    path: '/today',
    Icon: IconSparkle,
    items: [
      { id: 'today-overview', label: '今日概览', path: '/today', Icon: IconSparkle },
      { id: 'today-activity', label: '通知中心', path: '/today/activity', Icon: IconBell },
    ],
  },
  {
    id: 'chat',
    label: '对话',
    path: '/chat',
    Icon: IconChat,
    items: [{ id: 'chat-agent', label: 'Agent 对话', path: '/chat', Icon: IconChat }],
  },
  {
    id: 'workspace',
    label: '工作区',
    path: '/workspace/repositories',
    Icon: IconRepo,
    items: [
      { id: 'workspace-repositories', label: '本地仓库', path: '/workspace/repositories', Icon: IconRepo },
      { id: 'workspace-sql', label: 'SQL 工作台', path: '/workspace/sql', Icon: IconDatabase },
      { id: 'workspace-datasources', label: '数据源', path: '/workspace/datasources', Icon: IconServer },
      { id: 'workspace-sql-files', label: 'SQL 文件', path: '/workspace/sql-files', Icon: IconSqlFile },
      { id: 'workspace-variables', label: '变量', path: '/workspace/variables', Icon: IconVariable },
      { id: 'workspace-servers', label: '远程服务器', path: '/workspace/servers', Icon: IconServer },
      { id: 'workspace-shell-files', label: 'Shell 文件', path: '/workspace/shell-files', Icon: IconShell },
      { id: 'workspace-industrial-gateway', label: '工业网关', path: '/industrial-gateway', Icon: IconServer },
    ],
  },
  {
    id: 'knowledge',
    label: '知识',
    path: '/knowledge/notes',
    Icon: IconWiki,
    items: [
      { id: 'knowledge-notes', label: '笔记', path: '/knowledge/notes', Icon: IconNotes },
      { id: 'knowledge-wiki', label: 'Wiki', path: '/knowledge/wiki', Icon: IconWiki },
      { id: 'knowledge-memory', label: '记忆', path: '/knowledge/memory', Icon: IconMemory },
      { id: 'knowledge-resources', label: '资源', path: '/knowledge/resources', Icon: IconResources },
      { id: 'knowledge-search', label: '知识检索', path: '/knowledge/search', Icon: IconSearchGrid },
      { id: 'knowledge-output-profiles', label: '输出配置', path: '/knowledge/output-profiles', Icon: IconSparkle },
    ],
  },
  {
    id: 'automations',
    label: '自动化',
    path: '/automations/calendar',
    Icon: IconOrchestration,
    items: [
      { id: 'automations-calendar', label: '日历', path: '/automations/calendar', Icon: IconCalendar },
      { id: 'automations-tasks', label: '定时任务', path: '/automations/tasks', Icon: IconBell },
      { id: 'automations-orchestrations', label: '流程编排', path: '/automations/orchestrations', Icon: IconOrchestration },
      { id: 'automations-runs', label: '执行记录', path: '/automations/runs', Icon: IconLoad },
    ],
  },
  {
    id: 'capabilities',
    label: '能力与连接',
    path: '/capabilities/skills',
    Icon: IconSkills,
    items: [
      { id: 'capabilities-skills', label: 'Skills', path: '/capabilities/skills', Icon: IconSkills },
      { id: 'capabilities-tools', label: '工具箱', path: '/capabilities/tools', Icon: IconToolbox },
      { id: 'capabilities-search', label: '搜索源', path: '/capabilities/search', Icon: IconSearchGrid },
      { id: 'capabilities-channels', label: '外部通道', path: '/capabilities/channels', Icon: IconSocial },
    ],
  },
  {
    id: 'settings',
    label: '设置',
    path: '/settings/models',
    Icon: IconSettings,
    items: [
      { id: 'settings-models', label: '模型接入', path: '/settings/models', Icon: IconChat },
      { id: 'settings-agent', label: 'Agent 与权限', path: '/settings/agent', Icon: IconSettings },
      { id: 'settings-appearance', label: '外观与动态', path: '/settings/appearance', Icon: IconSparkle },
      { id: 'settings-system', label: '系统维护', path: '/settings/system', Icon: IconServer },
    ],
  },
] as const

export const NAV_ITEMS: ReadonlyArray<NavItem> = NAV_SECTIONS.flatMap((section) => section.items)

export function navItemMatches(pathname: string, item: NavItem) {
  return pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path + '/'))
}

export function navSectionForPath(pathname: string) {
  return (
    NAV_SECTIONS.find(
      (section) =>
        navItemMatches(pathname, section) ||
        section.items.some((item) => navItemMatches(pathname, item)),
    ) ?? NAV_SECTIONS[0]
  )
}
