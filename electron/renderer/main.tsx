import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import './app.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <main className="empty"><strong>Finder Selection Sync</strong><pre>{this.state.error.message}</pre></main> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
