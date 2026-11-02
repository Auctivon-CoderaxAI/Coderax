export type ProductStatus = 'live' | 'preview' | 'in-development';

export interface Product {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: ProductStatus;
  availabilityNote: string;
  icon: string;
  shortcut: string;
  launchKind: 'internal' | 'external' | 'none';
  target: string | null;
  cta: string;
  roadmap: string[];
}

export type LaunchAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'roadmap' };

export declare const PRODUCTS: ReadonlyArray<Product>;
export declare const STATUS_LABELS: Record<ProductStatus, string>;
export declare const PRODUCT_ORDER: ReadonlyArray<string>;

export declare function getProduct(id: string): Product | undefined;
export declare function getOrderedProducts(): Product[];
export declare function getLaunchableProducts(): Product[];
export declare function isLaunchable(product: Product): boolean;
export declare function resolveLaunch(product: Product): LaunchAction;
export declare function productForPath(pathname: string): string | null;
