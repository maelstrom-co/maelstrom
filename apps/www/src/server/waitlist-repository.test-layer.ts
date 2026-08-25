import { Layer } from 'effect';
import {
  WaitlistRepository,
  type WaitlistRepositoryService,
} from './waitlist-repository';

export const makeWaitlistRepositoryTestLayer = (
  overrides: Layer.PartialEffectful<WaitlistRepositoryService>,
): Layer.Layer<WaitlistRepository> => Layer.mock(WaitlistRepository, overrides);
