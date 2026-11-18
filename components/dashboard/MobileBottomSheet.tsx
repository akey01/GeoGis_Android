'use client';

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileBottomSheetProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function MobileBottomSheet({
  isOpen,
  title,
  onClose,
  children,
}: MobileBottomSheetProps) {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 rounded-t-3xl z-50 transition-all duration-300 ease-in-out transform',
          isOpen ? 'translate-y-0 h-[82vh]' : 'translate-y-full pointer-events-none'
        )}
      >
        <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto my-3" />
        <div className="flex justify-between items-center px-5 mb-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(82vh-72px)] pb-24 px-4">
          {children}
        </div>
      </div>
    </>
  );
}
