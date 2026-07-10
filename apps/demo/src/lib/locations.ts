export interface DemoLocation {
  readonly id: 'home' | 'office' | 'gym' | 'cafe';
  readonly name: string;
  readonly lng: number;
  readonly lat: number;
}

export const DEMO_LOCATIONS: readonly DemoLocation[] = [
  { id: 'home', name: 'Home', lng: -122.433, lat: 37.7648 },
  { id: 'office', name: 'Studio Vortex HQ', lng: -122.4194, lat: 37.7793 },
  { id: 'gym', name: 'Mission High Fitness', lng: -122.4262, lat: 37.7692 },
  { id: 'cafe', name: 'Ritual Coffee', lng: -122.4216, lat: 37.7614 },
];

export const HOME: DemoLocation = DEMO_LOCATIONS[0];

export function findLocationByFuzzyName(
  query: string,
): DemoLocation | undefined {
  const q = query.toLowerCase().trim();
  return (
    DEMO_LOCATIONS.find(
      (loc) => loc.name.toLowerCase() === q || loc.id === q,
    ) ??
    DEMO_LOCATIONS.find(
      (loc) => loc.name.toLowerCase().includes(q) || loc.id.includes(q),
    )
  );
}
