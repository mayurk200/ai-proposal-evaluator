import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Upload, FileText, GitCompare,
  Settings, LogOut, Leaf, Menu, X, ChevronRight, Info
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/auth.service';
import { APP_VERSION } from '@/version';



const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Upload, label: 'Upload Proposal', path: '/upload' },
  { icon: FileText, label: 'Proposals', path: '/proposals' },
  { icon: GitCompare, label: 'Compare', path: '/compare' },
  { icon: Settings, label: 'Settings', path: '/settings' },
  { icon: Info, label: 'About', path: '/about' },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  // Collapsed by default so pages get the full width; users can expand anytime.
  const [collapsed, setCollapsed] = useState(true);

  const handleLogout = () => {
    // Revoke the server-side session (best effort), then clear local state.
    authApi.logout().catch(() => {});
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
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold text-gradient whitespace-nowrap">AgriEval</h1>
                <span className="rounded-md bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">Beta</span>
              </div>
              <p className="text-[10px] text-text-muted whitespace-nowrap">AI Proposal Platform · v{APP_VERSION}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path}>
              <motion.div
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`sidebar-link ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-3' : ''}`}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
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
                {isActive && !collapsed && (
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
            <p className="text-xs text-text-muted truncate">{user.email}</p>
          </div>
        )}

        {isAuthenticated ? (
          <button
            onClick={handleLogout}
            className={`sidebar-link w-full text-red-500 hover:bg-red-50 hover:text-red-600 ${collapsed ? 'justify-center px-3' : ''}`}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        ) : (
          <Link
            to="/login"
            className={`sidebar-link w-full text-primary hover:bg-accent/10 ${collapsed ? 'justify-center px-3' : ''}`}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0 rotate-180" />
            {!collapsed && <span>Login / Sign up</span>}
          </Link>
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
