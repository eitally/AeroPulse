import React from 'react';
import { AlertTriangle, RotateCcw } from './icons/PhosphorIcons';
import type { ActiveTab } from '../types';
import {
  isDynamicChunkLoadError,
  purgeStaleRuntimeChunkCaches,
  triggerChunkSkewReload,
} from '../utils/lazyWithRetry';

export interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string | number | boolean;
  restoreTab?: ActiveTab;
  fallbackTitle?: string;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

/**
 * Safety net around lazy-loaded workspace tabs, modals, and root <App /> so neither a
 * deploy-time chunk mismatch nor a runtime view error can unmount the UI to a blank screen.
 */
export class WorkspaceErrorBoundary extends React.Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: WorkspaceErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error): void {
    if (isDynamicChunkLoadError(error)) {
      triggerChunkSkewReload(
        `boundary-${this.props.restoreTab || 'app'}`,
        this.props.restoreTab
      );
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleReloadLatestBuild = (): void => {
    void purgeStaleRuntimeChunkCaches().finally(() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const isChunkMismatch = isDynamicChunkLoadError(error);
    const title =
      this.props.fallbackTitle ||
      (isChunkMismatch ? 'Refreshing Updated THRESH View' : 'Workspace View Needs Recovery');

    return (
      <section
        role="alert"
        data-testid="workspace-error-boundary"
        className="ap-card p-6 space-y-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-[#C8FF00] shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              {isChunkMismatch
                ? 'A newer THRESH build was deployed while this tab was open. Reload to sync the updated view and return right here.'
                : 'Something interrupted this view while rendering. Retry the panel or reload the latest THRESH build.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="error-boundary-retry-btn"
            onClick={this.handleRetry}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry View</span>
          </button>
          <button
            type="button"
            data-testid="error-boundary-reload-btn"
            onClick={this.handleReloadLatestBuild}
            className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>Reload Latest Build</span>
          </button>
        </div>
      </section>
    );
  }
}
