// Vendor selection for the Act page — real low-carbon infrastructure vendors
// across Singapore, Bangkok and Hanoi, filterable by circular credential.
//
// Vendors come from sourced research (data/vendor_directory.json) and carry a
// verification tag (verified / partial / indicative) so the UI can be honest
// about which claims are confirmed. The take-back filter answers the
// circular-economy judge directly: "show me only vendors who collect and
// recycle the asset at end-of-life."

import type { AssetKind } from "./decisionBrief";
import dir from "@/data/vendor_directory.json";

export type VendorCity = "Singapore" | "Bangkok" | "Hanoi";
export type Verification = "verified" | "partial" | "indicative";

export interface Vendor {
  name: string;
  city: VendorCity;
  website: string;
  verification: Verification;
  offers: string;
  limitations: string;
  scale: string;
  circular: string[];
  takeback: boolean;
  secondLife: boolean;
  recycledContent: boolean;
  certifications: string;
  reputation: string;
  rating: number; // indicative credibility signal, 0..5
  publicSector: boolean;
  forKind: AssetKind;
}

const VENDORS = (dir as any).vendors as Record<string, Omit<Vendor, "forKind">[]>;
export const RATING_BASIS = (dir as any).rating_basis as string;
export const VERIFICATION_LABELS = (dir as any).verification_labels as Record<Verification, string>;

export interface VendorFilter {
  city?: VendorCity | "all";
  takebackOnly?: boolean; // any of take-back / second-life / recycled-content
}

/**
 * Vendors for the present asset kinds, optionally filtered by city and circular
 * credential. Deduped by name+kind, sorted by verification then rating.
 */
export function vendorsForKinds(kinds: AssetKind[], filter: VendorFilter = {}): Vendor[] {
  const out: Vendor[] = [];
  const seen = new Set<string>();
  const rank: Record<Verification, number> = { verified: 0, partial: 1, indicative: 2 };
  for (const k of kinds) {
    for (const v of VENDORS[k] ?? []) {
      const key = `${v.name}:${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const vendor: Vendor = { ...(v as any), forKind: k };
      if (filter.city && filter.city !== "all" && vendor.city !== filter.city) continue;
      if (filter.takebackOnly && !(vendor.takeback || vendor.secondLife || vendor.recycledContent))
        continue;
      out.push(vendor);
    }
  }
  return out.sort((a, b) => rank[a.verification] - rank[b.verification] || b.rating - a.rating);
}

/** Cities that actually have at least one vendor for the present kinds. */
export function availableCities(kinds: AssetKind[]): VendorCity[] {
  const cities = new Set<VendorCity>();
  for (const k of kinds) for (const v of VENDORS[k] ?? []) cities.add(v.city as VendorCity);
  return [...cities];
}
