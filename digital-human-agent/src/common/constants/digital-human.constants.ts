export const DIGITAL_HUMAN_PROVIDER = Symbol('DIGITAL_HUMAN_PROVIDER');

export const DIGITAL_HUMAN_PROVIDER_NAME = {
  mock: 'mock',
  simli: 'simli',
} as const;

export const DEFAULT_DIGITAL_HUMAN_PROVIDER = DIGITAL_HUMAN_PROVIDER_NAME.mock;
