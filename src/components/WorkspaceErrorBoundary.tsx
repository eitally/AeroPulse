import React from 'react';
import { AlertTriangle, Download, RotateCcw } from './icons/PhosphorIcons';
import type { ActiveTab } from '../types';
import {
  isDynamicChunkLoadError,
  purgeStaleRuntimeChunkCaches,
  triggerChunkSkewReload,
} from '../utils/lazyWithRetry';
import { downloadSupportDiagnosticsJson } from '../utils/supportDiagnostics';

export interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string | number | boolean;
  restoreTab?: ActiveTab;
  fallbackTitle?: string;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
  downloadingDiagnostics?: boolean;
  diagnosticsDone?: boolean;
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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[MeetReady Boundary]', error, errorInfo);
    if (isDynamicChunkLoadError(error)) {
      triggerChunkSkewReload(
        `boundary-${this.props.restoreTab || 'app'}`,
        this.props.restoreTab
      );
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null, downloadingDiagnostics: false, diagnosticsDone: false });
  };

  private handleReloadLatestBuild = (): void => {
    void purgeStaleRuntimeChunkCaches({ forceUnregisterSw: true }).finally(() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });
  };

  private handleDownloadDiagnostics = (): void => {
    const activeError = this.state.error;
    this.setState({ downloadingDiagnostics: true });
    void downloadSupportDiagnosticsJson({
      source: 'workspace-error-boundary',
      restoreTab: this.props.restoreTab,
      boundaryError: activeError,
    })
      .then((res) => {
        this.setState({
          downloadingDiagnostics: false,
          diagnosticsDone: Boolean(res?.downloaded || res?.snapshot),
        });
      })
      .catch(() => {
        this.setState({ downloadingDiagnostics: false });
      });
  };

  render(): React.ReactNode {
    const { error, downloadingDiagnostics, diagnosticsDone } = this.state;
    if (!error) {
      return this.props.children;
    }

    const isChunkMismatch = isDynamicChunkLoadError(error);
    const title =
      this.props.fallbackTitle ||
      (isChunkMismatch ? 'Refreshing Updated MeetReady View' : 'Workspace View Needs Recovery');

    return (
      <section
        role="alert"
        data-testid="workspace-error-boundary"
        className="ap-card p-6 space-y-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-ap-volt shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              {isChunkMismatch
                ? 'A newer MeetReady build was deployed while this tab was open. Reload to sync the updated view and return right here.'
                : 'Something interrupted this view while rendering. Retry the panel or reload the latest MeetReady build.'}
            </p>
            <details className="pt-1 text-2xs font-mono text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer select-none hover:underline">
                Technical details
              </summary>
              <div className="mt-1 rounded-lg bg-slate-100 dark:bg-ap-carbon px-2.5 py-1.5 break-all">
                {error.name}: {error.message}
              </div>
            </details>
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
          <button
            type="button"
            data-testid="error-boundary-diagnostics-btn"
            disabled={Boolean(downloadingDiagnostics)}
            onClick={this.handleDownloadDiagnostics}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {downloadingDiagnostics
                ? 'Preparing Diagnostics…'
                : diagnosticsDone
                  ? 'Diagnostics Downloaded'
                  : 'Download Support Diagnostics'}
            </span>
          </button>
        </div>
      </section>
    );
  }
}
