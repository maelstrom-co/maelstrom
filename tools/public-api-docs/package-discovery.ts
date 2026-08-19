import { listPublishablePackages } from '../../scripts/lib/workspace-packages';

export interface PublishablePackageManifest {
  name: string;
  private?: boolean;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface PublishablePackage {
  directory: string;
  manifest: PublishablePackageManifest;
}

export async function discoverPublishablePackages(
  root: string,
): Promise<PublishablePackage[]> {
  return listPublishablePackages(root).map((package_) => ({
    directory: package_.dir,
    manifest: {
      ...package_.manifest,
      name: package_.name,
    } as PublishablePackageManifest,
  }));
}
