'use client';

import React from 'react';
import { Settings, Map as MapIcon, FileText, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileTab = 'map' | 'settings' | 'results' | 'projects';

interface BottomNavMobileProps {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
}

export default function BottomNavMobile({ activeTab, onSelectTab }: BottomNavMobileProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-20 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 z-[60] flex items-center justify-around px-6 pb-2">
      <button
        type="button"
        onClick={() => onSelectTab(activeTab === 'settings' ? 'map' : 'settings')}
        className={cn(
          'flex flex-col items-center gap-1 transition-all',
          activeTab === 'settings' ? 'text-emerald-400' : 'text-slate-500'
        )}
      >
        <Settings className={cn('w-6 h-6', activeTab === 'settings' && 'animate-pulse')} />
        <span className="text-[10px] font-bold uppercase tracking-widest">Ajustes</span>
      </button>

      <div className="relative -top-6">
        <button
          type="button"
          onClick={() => onSelectTab('map')}
          className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all border-4 border-[#0a0f18]',
            activeTab === 'map'
              ? 'bg-emerald-500 text-white scale-110 shadow-emerald-500/40'
              : 'bg-slate-800 text-slate-400 shadow-black/40'
          )}
        >
          <MapIcon className="w-6 h-6" />
        </button>
        <span
          className={cn(
            'absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap',
            activeTab === 'map' ? 'text-emerald-400' : 'text-slate-500'
          )}
        >
          Mapa
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSelectTab(activeTab === 'results' ? 'map' : 'results')}
        className={cn(
          'flex flex-col items-center gap-1 transition-all',
          activeTab === 'results' ? 'text-emerald-400' : 'text-slate-500'
        )}
      >
        <FileText className={cn('w-5 h-5', activeTab === 'results' && 'animate-pulse')} />
        <span className="text-[9px] font-bold uppercase tracking-widest">Resultados</span>
      </button>

      <button
        type="button"
        onClick={() => onSelectTab(activeTab === 'projects' ? 'map' : 'projects')}
        className={cn(
          'flex flex-col items-center gap-1 transition-all',
          activeTab === 'projects' ? 'text-emerald-400' : 'text-slate-500'
        )}
      >
        <Database className={cn('w-5 h-5', activeTab === 'projects' && 'animate-pulse')} />
        <span className="text-[9px] font-bold uppercase tracking-widest">Proyectos</span>
      </button>
    </nav>
  );
}
