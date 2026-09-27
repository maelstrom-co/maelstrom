import type { PlaygroundMetadata } from '../server/playground-metadata';

export class EngineMetadataStore {
  private owner: symbol | undefined;
  private value: PlaygroundMetadata | undefined;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  begin(owner: symbol) {
    this.owner = owner;
    this.set(undefined);
  }
  receive(owner: symbol, value: PlaygroundMetadata) {
    if (this.owner === owner) this.set(value);
  }
  clear(owner: symbol) {
    if (this.owner !== owner) return;
    this.owner = undefined;
    this.set(undefined);
  }
  private set(value: PlaygroundMetadata | undefined) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

export const engineMetadata = new EngineMetadataStore();
