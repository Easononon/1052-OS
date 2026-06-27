import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import IndustrialAgentMark from '../components/IndustrialAgentMark'
import { NAV_ITEMS } from './nav'
import { MirrorText, MirrorChip } from './primitives'

const COLLAPSED_KEY = 'agent.sidebar.collapsed'

export function MirrorSidebar() {
  const loc = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  return (
    <aside className={'mr-sidebar' + (collapsed ? ' is-collapsed' : '')}>
      <div className="mr-sidebar-brand">
        <IndustrialAgentMark size={34} />
        <div className="mr-sidebar-brand-copy">
          <MirrorText role="title" as="span">工控智能 Agent</MirrorText>
          <MirrorText role="meta" as="span">Industrial Copilot</MirrorText>
        </div>
        <button
          className="mr-sidebar-collapse"
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className={collapsed ? 'is-flipped' : ''}
          >
            <path
              d="M9 3L5 7L9 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <MirrorText role="label" as="div" className="mr-sidebar-section">导航</MirrorText>
      <nav className="mr-nav">
        {NAV_ITEMS.map((item) => {
          const active =
            loc.pathname === item.path ||
            (item.path !== '/' && loc.pathname.startsWith(item.path + '/'))
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`mr-nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <item.Icon size={16} className="mr-nav-icon" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="mr-sidebar-footer">
        <div className="mr-chip-row">
          <MirrorChip active>Agent</MirrorChip>
          <MirrorChip>01</MirrorChip>
          <MirrorChip>02</MirrorChip>
          <MirrorChip>03</MirrorChip>
          <MirrorChip>04</MirrorChip>
          <MirrorChip>05</MirrorChip>
          <MirrorChip>06</MirrorChip>
        </div>
        <div className="mr-user-row">
          <div className="mr-avatar" />
          <div className="mr-user-info">
            <MirrorText role="title" as="div">本地用户</MirrorText>
            <MirrorText role="meta" as="div">● 在线</MirrorText>
          </div>
        </div>
      </div>
    </aside>
  )
}
