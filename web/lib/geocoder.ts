const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export async function reverseCountry(
  lat: number,
  lng: number,
  key: string
): Promise<string | null> {
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    result_type: "country",
    key,
  });
  const res = await fetch(`${GEOCODE_URL}?${params}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const result of data.results ?? []) {
    for (const comp of result.address_components ?? []) {
      if ((comp.types ?? []).includes("country")) {
        return comp.short_name;
      }
    }
  }
  return null;
}
