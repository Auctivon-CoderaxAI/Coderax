import type { BalanceRefillMode, RefillIntervalUnit } from 'coderax-data-provider';

export interface BalanceUpdateFields {
  user?: string;
  tokenCredits?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: RefillIntervalUnit;
  refillAmount?: number;
  refillMode?: BalanceRefillMode;
  lastRefill?: Date;
}
