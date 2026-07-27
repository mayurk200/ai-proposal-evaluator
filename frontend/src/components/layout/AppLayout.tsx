import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, BarChart3, ChevronRight, Copy, FileText, LayoutDashboard,
  Leaf, LogOut, Menu, PanelLeftClose, Settings, Upload
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { analyticsApi } from '@/services/agrieval.service';
import type { Role } from '@/types';

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  /** Restrict the link to these roles. Cosmetic — the gateway enforces the real rule. */
  roles?: Role[];
  /**
   * A live count next to the link.
   *
   * `awaiting_review` is work blocked on this person; `queue` is work the
   * server is doing on its own. Different meanings, so they are toned
   * differently — amber for "you are the blocker", blue for "it is in hand".
   */
  badge?: 'awaiting_review' | 'queue';
}

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Upload, label: 'Upload', path: '/upload' },
  { icon: FileText, label: 'Proposals', path: '/proposals' },
  // The duplicate gate. Badged, because an idea sitting here is blocking work.
  { icon: Copy, label: 'Duplicate review', path: '/review', badge: 'awaiting_review' },
  // Badged with what the server is chewing through, so an upload that is still
  // processing is visible from anywhere in the app.
  { icon: Activity, label: 'Activity', path: '/activity', badge: 'queue' },
  { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  { icon: Settings, label: 'System', path: '/settings', roles: ['ADMIN'] },
];

export function Sidebar({
  collapsed,
  setCollapsed,
  onNavigate,
}: {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  /** Called after a nav link is followed. The mobile drawer closes itself. */
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, hasRole } = useAuthStore();

  const { data: overview } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: analyticsApi.overview,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const visible = navItems.filter(
    (item) => !item.roles || hasRole(...item.roles),
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 260 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex h-full flex-col border-r border-border bg-surface"
    >
      {/* Logo */}
      <Link to="/" className="flex items-center gap-3 px-4 py-4 border-b border-border hover:bg-accent-light/40 transition-colors">
        <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="overflow-hidden"
            >
              <h1 className="text-lg font-bold text-gradient whitespace-nowrap">AgriEval</h1>
              <p className="text-[10px] text-text-muted whitespace-nowrap">AI Proposal Platform</p>
            </motion.div>
          )}
        </AnimatePresence>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visible.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          const count =
            item.badge === 'awaiting_review'
              ? overview?.totals.awaiting_review ?? 0
              : item.badge === 'queue'
                ? overview?.queue?.pending ?? 0
                : 0;
          const blocking = item.badge === 'awaiting_review';

          return (
            <Link key={item.path} to={item.path} onClick={onNavigate}>
              <motion.div
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`sidebar-link ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-3' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  <item.icon className="w-[18px] h-[18px]" />
                  {/* When collapsed there is no room for a number, but the user still
                      needs to know something is waiting. */}
                  {count > 0 && collapsed && (
                    <span
                      className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${
                        blocking ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                    />
                  )}
                </div>

                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="whitespace-nowrap"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>

                {!collapsed && count > 0 && (
                  <span
                    className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      blocking ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {count}
                  </span>
                )}
                {isActive && !collapsed && count === 0 && (
                  <ChevronRight className="w-4 h-4 ml-auto text-primary" />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* User & Collapse */}
      <div className="space-y-1 border-t border-border px-3 py-3">
        {!collapsed && user && (
          <div className="px-3 py-2">
            <p className="truncate text-[13px] font-medium text-text">{user.name}</p>
            <p className="truncate text-xs text-text-muted">{user.email}</p>
            <span className="mt-1 inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
              {user.role}
            </span>
          </div>
        )}

        {isAuthenticated && (
          <button
            onClick={handleLogout}
            className={`sidebar-link w-full text-red-600 hover:bg-red-50 hover:text-red-700 ${collapsed ? 'justify-center px-3' : ''}`}
          >
            <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        )}

        {/* Collapsing is a desktop affordance. On a phone the sidebar is a
            drawer that is either open or gone, so this would be a third state
            with no meaning. */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`sidebar-link hidden w-full lg:flex ${collapsed ? 'justify-center px-3' : ''}`}
        >
          {collapsed ? (
            <Menu className="h-[18px] w-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}

/**
 * The application shell.
 *
 * Two arrangements, not one that stretches. On a desktop the sidebar is a
 * permanent column. Below `lg` it becomes a drawer over the content, because a
 * 260px permanent rail on a 390px screen leaves 130px for a data table — which
 * is what it did, and it made every page unreadable on a phone.
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer closes itself on navigation via `onNavigate` on each link, so
  // there is no pathname effect here — syncing it from the router would be a
  // second source of truth for the same thing.

  // Escape closes it — a full-screen overlay with no keyboard exit is a trap.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail */}
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[260px]">
            <Sidebar
              collapsed={false}
              setCollapsed={() => {}}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* The rail is fixed, so the content is offset by padding rather than by
          flex — that keeps the sidebar in place on a long page. */}
      <div
        className={`transition-[padding] duration-300 ${
          collapsed ? 'lg:pl-[76px]' : 'lg:pl-[260px]'
        }`}
      >
        <div>
          {/* Mobile top bar */}
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur-sm lg:hidden">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg p-1.5 text-text-secondary hover:bg-gray-100 hover:text-text"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-primary">
                <Leaf className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold text-gradient">AgriEval</span>
            </Link>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
