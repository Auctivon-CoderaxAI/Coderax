import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CloudCog,
  Globe,
  MessagesSquare,
  Monitor,
  TerminalSquare,
  X,
} from 'lucide-react';

import {
  PRODUCTS,
  STATUS_DOT,
  STATUS_LABELS,
  type IconName,
  type Product,
  getOrderedProducts,
  productForPath,
} from './products';

const ICONS: Record<IconName, typeof Monitor> = {
  Monitor,
  TerminalSquare,
  Globe,
  CloudCog,
  MessagesSquare,
};

const COMPACT_QUERY = '(max-width: 1099px)';

function useIsCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    setCompact(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return compact;
}

const surface = {
  background: 'var(--surface-primary, #ffffff)',
  color: 'var(--text-primary, #171717)',
  border: '1px solid var(--border-light, #e5e5e5)',
} as const;

function StatusBadge({ product }: { product: Product }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: 'var(--text-secondary, #4b5563)',
        background: 'var(--surface-tertiary, #f4f4f5)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: STATUS_DOT[product.status] }}
      />
      {STATUS_LABELS[product.status]}
    </span>
  );
}

interface LauncherProps {
  onClose: () => void;
  onSelect: (product: Product) => void;
  currentId: string | null;
  compact: boolean;
}

function ProductLauncher({ onClose, onSelect, currentId, compact }: LauncherProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const products = useMemo(() => getOrderedProducts(), []);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      const match = products.find((product) => product.shortcut === event.key);
      if (match && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onSelect(match);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onSelect, products]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{ background: 'rgba(15, 23, 42, 0.55)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coderax-products-heading"
        className="w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{
          ...surface,
          maxWidth: compact ? '100%' : 880,
          maxHeight: compact ? '88vh' : '80vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2
              id="coderax-products-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-lg font-semibold outline-hidden"
            >
              Choose a product
            </h2>
            <p
              className="mt-1 text-sm"
              style={{ color: 'var(--text-secondary, #6b7280)' }}
            >
              Five ways into Coderax. Status reflects what is actually available today.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product launcher"
            className="rounded-md p-1.5 hover:opacity-70"
            style={{ border: '1px solid var(--border-light, #e5e5e5)' }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const Icon = ICONS[product.icon];
            const isCurrent = product.id === currentId;
            return (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onSelect(product)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className="flex h-full w-full flex-col rounded-xl p-4 text-left transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{
                    border: isCurrent
                      ? '1px solid var(--accent-primary, #126e6b)'
                      : '1px solid var(--border-light, #e5e5e5)',
                    background: isCurrent
                      ? 'var(--surface-tertiary, #f8fafc)'
                      : 'var(--surface-primary, #ffffff)',
                  }}
                >
                  <div className="mb-3 flex w-full items-start justify-between gap-3">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ background: 'var(--surface-tertiary, #f4f4f5)' }}
                    >
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <StatusBadge product={product} />
                  </div>
                  <h3 className="text-sm font-semibold">{product.name}</h3>
                  <p
                    className="mt-1 text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary, #6b7280)' }}
                  >
                    {product.tagline}
                  </p>
                  {isCurrent && (
                    <span
                      className="mt-3 text-[11px] font-medium"
                      style={{ color: 'var(--accent-primary, #126e6b)' }}
                    >
                      You are here
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p
          className="px-6 pb-6 text-[11px]"
          style={{ color: 'var(--text-secondary, #9ca3af)' }}
        >
          Press 1\u20135 to jump, Esc to close. In-development products open their roadmap
          instead of a dead link.
        </p>
      </div>
    </div>
  );
}

interface RoadmapProps {
  product: Product;
  onClose: () => void;
  onBack: () => void;
}

function RoadmapPanel({ product, onClose, onBack }: RoadmapProps) {
  const Icon = ICONS[product.icon];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="presentation"
      style={{ background: 'rgba(15, 23, 42, 0.55)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coderax-roadmap-heading"
        className="w-full max-w-lg overflow-hidden rounded-2xl p-6 shadow-2xl"
        style={surface}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ background: 'var(--surface-tertiary, #f4f4f5)' }}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="coderax-roadmap-heading" className="text-base font-semibold">
                {product.name}
              </h2>
              <StatusBadge product={product} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close roadmap"
            className="rounded-md p-1.5 hover:opacity-70"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed">
          {product.availabilityNote}
        </p>

        {product.roadmap.length > 0 && (
          <>
            <h3
              className="mt-5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-secondary, #6b7280)' }}
            >
              Planned
            </h3>
            <ul className="mt-2 space-y-1.5">
              {product.roadmap.map((item) => (
                <li key={item} className="flex gap-2 text-sm">
                  <span aria-hidden="true" style={{ color: 'var(--accent-primary, #126e6b)' }}>
                    \u2022
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--border-light, #e5e5e5)' }}
          >
            Back to products
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Option 7 \u2014 product rail plus launcher.
 *
 * Renders a 68px rail in normal flow (so it sits beside the existing sidebar
 * without overlaying it) and a dialog launcher. The model selector, Chat/Work
 * switch and bottom composer are untouched.
 */
export default function ProductSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useIsCompact();
  const [open, setOpen] = useState(false);
  const [roadmap, setRoadmap] = useState<Product | null>(null);

  const currentId = useMemo(() => productForPath(location.pathname), [location.pathname]);

  const closeAll = useCallback(() => {
    setOpen(false);
    setRoadmap(null);
  }, []);

  const handleSelect = useCallback(
    (product: Product) => {
      setOpen(false);
      if (product.launchKind === 'internal' && product.target) {
        setRoadmap(null);
        navigate(product.target);
        return;
      }
      setRoadmap(product);
    },
    [navigate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const products = getOrderedProducts();

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Choose a Coderax product"
          className="fixed bottom-20 left-4 z-[110] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium shadow-lg"
          style={surface}
        >
          <MessagesSquare className="h-4 w-4" aria-hidden="true" />
          Products
        </button>
      ) : (
        <nav
          aria-label="Coderax products"
          className="flex h-full w-[68px] shrink-0 flex-col items-center gap-1 py-3"
          style={{
            borderRight: '1px solid var(--border-light, #e5e5e5)',
            background: 'var(--surface-secondary, #fafafa)',
          }}
        >
          {products.map((product) => {
            const Icon = ICONS[product.icon];
            const isCurrent = product.id === currentId;
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => handleSelect(product)}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={`${product.name} \u2014 ${STATUS_LABELS[product.status]}`}
                title={`${product.name} \u2014 ${STATUS_LABELS[product.status]}`}
                className="flex w-[56px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1"
                style={{
                  color: isCurrent
                    ? 'var(--accent-primary, #126e6b)'
                    : 'var(--text-secondary, #4b5563)',
                  background: isCurrent ? 'var(--surface-tertiary, #f4f4f5)' : 'transparent',
                }}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: STATUS_DOT[product.status] }}
                  />
                </span>
                <span className="truncate">{product.name}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-auto w-[56px] rounded-lg px-1 py-2 text-[10px] font-medium hover:opacity-80"
            style={{ color: 'var(--text-secondary, #4b5563)' }}
          >
            Choose\u2026
          </button>
        </nav>
      )}

      {open && (
        <ProductLauncher
          compact={compact}
          currentId={currentId}
          onClose={closeAll}
          onSelect={handleSelect}
        />
      )}

      {roadmap && (
        <RoadmapPanel
          product={roadmap}
          onClose={closeAll}
          onBack={() => {
            setRoadmap(null);
            setOpen(true);
          }}
        />
      )}
    </>
  );
}

export { PRODUCTS };
