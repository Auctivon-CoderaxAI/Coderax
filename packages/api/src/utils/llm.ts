import { coderax } from 'coderax-data-provider';
import type { DynamicSettingProps, ImageDetail } from 'coderax-data-provider';

type CoderaxKeys = keyof typeof coderax;

type CoderaxParams = {
  modelOptions: Omit<NonNullable<DynamicSettingProps['conversation']>, CoderaxKeys>;
  resendFiles: boolean;
  promptPrefix?: string | null;
  maxContextTokens?: number;
  fileTokenLimit?: number;
  modelLabel?: string | null;
  imageDetail?: ImageDetail;
};

/**
 * Separates Coderax-specific parameters from model options
 * @param options - The combined options object
 */
export function extractCoderaxParams(
  options?: DynamicSettingProps['conversation'],
): CoderaxParams {
  if (!options) {
    return {
      modelOptions: {} as Omit<NonNullable<DynamicSettingProps['conversation']>, CoderaxKeys>,
      resendFiles: coderax.resendFiles.default as boolean,
    };
  }

  const modelOptions = { ...options };

  const resendFiles =
    (delete modelOptions.resendFiles, options.resendFiles) ??
    (coderax.resendFiles.default as boolean);
  const promptPrefix = (delete modelOptions.promptPrefix, options.promptPrefix);
  const maxContextTokens = (delete modelOptions.maxContextTokens, options.maxContextTokens);
  const fileTokenLimit = (delete modelOptions.fileTokenLimit, options.fileTokenLimit);
  const modelLabel = (delete modelOptions.modelLabel, options.modelLabel);
  const imageDetail = (delete modelOptions.imageDetail, options.imageDetail);

  return {
    modelOptions: modelOptions as Omit<
      NonNullable<DynamicSettingProps['conversation']>,
      CoderaxKeys
    >,
    maxContextTokens,
    fileTokenLimit,
    promptPrefix,
    resendFiles,
    modelLabel,
    imageDetail,
  };
}
