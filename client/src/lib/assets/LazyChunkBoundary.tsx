import { Component } from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error) => void;
};

/** Keeps a rejected lazy chunk from replacing its entire route. */
export default class LazyChunkBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
