import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { WorkspaceErrorBoundary } from './components/WorkspaceErrorBoundary';
import { installVitePreloadErrorRecovery } from './utils/lazyWithRetry';
import './index.css';

installVitePreloadErrorRecovery();

createRoot(document.getElementById('root')!).render(
  <WorkspaceErrorBoundary fallbackTitle="Reload MeetReady Workspace">
    <App />
  </WorkspaceErrorBoundary>
);
