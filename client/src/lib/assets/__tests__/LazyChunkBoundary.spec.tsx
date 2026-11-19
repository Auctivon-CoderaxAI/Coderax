import { render, screen } from '@testing-library/react';
import LazyChunkBoundary from '../LazyChunkBoundary';

describe('LazyChunkBoundary', () => {
  it('contains a failed lazy child and keeps surrounding content mounted', () => {
    const onError = jest.fn();
    const failure = new Error('chunk failed');
    const FailedChild = () => {
      throw failure;
    };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <>
          <LazyChunkBoundary
            fallback={<span role="alert">Plain text fallback</span>}
            onError={onError}
          >
            <FailedChild />
          </LazyChunkBoundary>
          <span>Chat remains available</span>
        </>,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Plain text fallback');
      expect(screen.getByText('Chat remains available')).toBeInTheDocument();
      expect(onError).toHaveBeenCalledWith(failure);
    } finally {
      consoleError.mockRestore();
    }
  });
});
