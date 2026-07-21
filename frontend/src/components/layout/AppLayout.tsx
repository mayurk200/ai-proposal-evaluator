import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, BarChart3, ChevronRight, Copy, FileText, LayoutDashboard,
  Leaf, LogOut, Menu, Settings, Upload, X
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

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, hasRole } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

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
      className="h-screen sticky top-0 flex flex-col bg-white/70 backdrop-blur-xl border-r border-border"
    >
      {/* Logo */}
      <Link to="/" className="flex items-center gap-3 px-5 py-5 border-b border-border/50 hover:bg-accent/10 transition-colors">
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
            <Link key={item.path} to={item.path}>
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
      <div className="px-3 py-4 border-t border-border/50 space-y-2">
        {!collapsed && user && (
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-text truncate">{user.name}</p>
            <p className="text-xs text-text-muted truncate">
              {user.email}
            </p>
            <span className="mt-1 inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
              {user.role}
            </span>
          </div>
        )}

        {isAuthenticated && (
          <button
            onClick={handleLogout}
            className={`sidebar-link w-full text-red-500 hover:bg-red-50 hover:text-red-600 ${collapsed ? 'justify-center px-3' : ''}`}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`sidebar-link w-full ${collapsed ? 'justify-center px-3' : ''}`}
        >
          {collapsed ? <Menu className="w-[18px] h-[18px]" /> : (
            <>
              <X className="w-[18px] h-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
