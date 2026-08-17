"use client";

import { Component, type ReactNode } from "react";

type ModuleErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  onOpenDashboard: () => void;
};

type ModuleErrorBoundaryState = { failed: boolean };

export default class ModuleErrorBoundary extends Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  state: ModuleErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    // The fallback intentionally avoids exposing render details or business data.
  }

  componentDidUpdate(previousProps: ModuleErrorBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel data-state data-state-error" role="alert">
        <span className="state-symbol" aria-hidden="true">!</span>
        <strong>当前模块发生异常</strong>
        <p>导航和筛选仍可使用。你可以重试当前模块，或先返回 BI 看板继续工作。</p>
        <div className="data-state-actions">
          <button className="secondary-button" onClick={() => this.setState({ failed: false })}>重试当前模块</button>
          <button className="primary-button" onClick={this.props.onOpenDashboard}>返回 BI 看板</button>
        </div>
      </section>
    );
  }
}
