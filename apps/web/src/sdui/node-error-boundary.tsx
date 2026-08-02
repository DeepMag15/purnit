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
        <div role="alert" data-node-error={this.props.nodeId} style={{ padding: "0.5rem", border: "1px solid #c33", borderRadius: 4, color: "#c33", fontSize: "0.875rem" }}>
          Something went wrong rendering this widget.
        </div>
      );
    }
    return this.props.children;
  }
}
