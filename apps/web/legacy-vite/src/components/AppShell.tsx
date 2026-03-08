import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Map as MapIcon, 
  History, 
  Settings, 
  ChevronRight, 
  LogOut, 
  User,
  Sparkles,
  Search
} from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({ 
  children, 
  activeTab, 
  setActiveTab,
  onLogout 
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'campaigns', label: 'Campaigns', icon: MapIcon },
    { id: 'sessions', label: 'Sessions', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside 
        className={`sidebar-gradient flex flex-col transition-all duration-300 ease-in-out border-r border-sidebar-border ${
          isSidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_var(--color-primary)]">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            {!isSidebarCollapsed && (
              <span className="text-xl font-serif italic font-bold tracking-tight text-foreground truncate">
                Meepo
              </span>
            )}
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav className="flex-1 px-3 space-y-1 mt-4">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                activeTab === item.id 
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_hsla(42,70%,65%,0.1)]' 
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 flex-shrink-0 ${
                activeTab === item.id ? 'text-primary' : 'text-muted-foreground group-hover:text-primary/70'
              }`} />
              {!isSidebarCollapsed && (
                <span className="ml-3 text-sm font-medium truncate">{item.label}</span>
              )}
              {activeTab === item.id && !isSidebarCollapsed && (
                <motion.div layoutId="active-indicator" className="ml-auto w-1 h-4 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <div className={`flex items-center p-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors cursor-pointer group ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 border border-border">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            {!isSidebarCollapsed && (
              <div className="ml-3 overflow-hidden">
                <p className="text-sm font-medium truncate">Adventurer</p>
                <p className="text-xs text-muted-foreground truncate">keemin7@gmail.com</p>
              </div>
            )}
            {!isSidebarCollapsed && (
              <button 
                onClick={onLogout}
                className="ml-auto p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background/50 backdrop-blur-md z-10">
          <div className="flex items-center space-x-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
              {activeTab}
            </h2>
            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold">The Shattered Crown</span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input 
                type="text" 
                placeholder="Search chronicle..." 
                className="pl-10 pr-4 py-1.5 bg-muted/30 border border-border rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all w-64"
              />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center cursor-pointer hover:bg-primary/20 transition-colors">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-8 max-w-7xl mx-auto w-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};
