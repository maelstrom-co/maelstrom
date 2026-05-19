export type VADCoordinatorState = {
  pendingFinalFromVAD: boolean;
  vadFinalDebounceTimeout: ReturnType<typeof setTimeout> | null;
};

export function createInitialVADCoordinatorState(): VADCoordinatorState {
  return {
    pendingFinalFromVAD: false,
    vadFinalDebounceTimeout: null,
  };
}
