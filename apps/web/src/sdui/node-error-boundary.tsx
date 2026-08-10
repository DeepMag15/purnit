"use client";

import { Component, type ReactNode } from "react";

interface Props {
  nodeId: string;
  nodeType: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wraps every rendered node individually — one broken widget must not blank
 * the rest of the workspace (ARCHITECTURE.md §7.5). Must be a class
 * component; React has no hook-based error boundary API.
 */
export class NodeErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[SDUI] node "${this.props.nodeId}" (${this.props.nodeType}) crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-node-error={this.props.nodeId}
          className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          Something went wrong rendering this widget.
        </div>
      );
    }
    return this.props.children;
  }
}
