export type LocalityOption = { value: string; label: string };
export type AdminAreaOption = { value: string; label: string; localities: LocalityOption[] };
export type RegionOption = {
  countryCode: string;
  label: string;
  defaultCurrency: string;
  defaultLocale: string;
  adminAreas: AdminAreaOption[];
};

const generalLocality: LocalityOption = { value: "General locality", label: "General / other city" };

export const REGION_OPTIONS: RegionOption[] = [
  {
    countryCode: "IN",
    label: "India",
    defaultCurrency: "INR",
    defaultLocale: "en-IN",
    adminAreas: [
      { value: "Delhi", label: "Delhi", localities: [{ value: "New Delhi", label: "New Delhi" }, { value: "Delhi", label: "Delhi" }, generalLocality] },
      { value: "Kerala", label: "Kerala", localities: [{ value: "Kochi", label: "Kochi" }, { value: "Thiruvananthapuram", label: "Thiruvananthapuram" }, { value: "Kozhikode", label: "Kozhikode" }, generalLocality] },
      { value: "Karnataka", label: "Karnataka", localities: [{ value: "Bengaluru", label: "Bengaluru" }, { value: "Mysuru", label: "Mysuru" }, generalLocality] },
      { value: "Maharashtra", label: "Maharashtra", localities: [{ value: "Mumbai", label: "Mumbai" }, { value: "Pune", label: "Pune" }, { value: "Nagpur", label: "Nagpur" }, generalLocality] },
      { value: "Tamil Nadu", label: "Tamil Nadu", localities: [{ value: "Chennai", label: "Chennai" }, { value: "Coimbatore", label: "Coimbatore" }, generalLocality] },
      { value: "Telangana", label: "Telangana", localities: [{ value: "Hyderabad", label: "Hyderabad" }, generalLocality] },
      { value: "Other Indian region", label: "General / other state or union territory", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "AE",
    label: "United Arab Emirates",
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    adminAreas: [
      { value: "Dubai", label: "Dubai", localities: [{ value: "Dubai", label: "Dubai" }, generalLocality] },
      { value: "Abu Dhabi", label: "Abu Dhabi", localities: [{ value: "Abu Dhabi", label: "Abu Dhabi" }, { value: "Al Ain", label: "Al Ain" }, generalLocality] },
      { value: "Other UAE emirate", label: "General / other emirate", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "US",
    label: "United States",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    adminAreas: [
      { value: "California", label: "California", localities: [{ value: "San Francisco", label: "San Francisco" }, { value: "Los Angeles", label: "Los Angeles" }, { value: "San Diego", label: "San Diego" }, generalLocality] },
      { value: "New York", label: "New York", localities: [{ value: "New York City", label: "New York City" }, generalLocality] },
      { value: "Texas", label: "Texas", localities: [{ value: "Austin", label: "Austin" }, { value: "Dallas", label: "Dallas" }, { value: "Houston", label: "Houston" }, generalLocality] },
      { value: "Other US state", label: "General / other state", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "GB",
    label: "United Kingdom",
    defaultCurrency: "GBP",
    defaultLocale: "en-GB",
    adminAreas: [
      { value: "England", label: "England", localities: [{ value: "London", label: "London" }, { value: "Manchester", label: "Manchester" }, { value: "Birmingham", label: "Birmingham" }, generalLocality] },
      { value: "Scotland", label: "Scotland", localities: [{ value: "Edinburgh", label: "Edinburgh" }, { value: "Glasgow", label: "Glasgow" }, generalLocality] },
      { value: "Other UK nation", label: "General / other nation", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "CA",
    label: "Canada",
    defaultCurrency: "CAD",
    defaultLocale: "en-CA",
    adminAreas: [
      { value: "Ontario", label: "Ontario", localities: [{ value: "Toronto", label: "Toronto" }, { value: "Ottawa", label: "Ottawa" }, generalLocality] },
      { value: "British Columbia", label: "British Columbia", localities: [{ value: "Vancouver", label: "Vancouver" }, generalLocality] },
      { value: "Other Canadian province", label: "General / other province or territory", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "AU",
    label: "Australia",
    defaultCurrency: "AUD",
    defaultLocale: "en-AU",
    adminAreas: [
      { value: "New South Wales", label: "New South Wales", localities: [{ value: "Sydney", label: "Sydney" }, generalLocality] },
      { value: "Victoria", label: "Victoria", localities: [{ value: "Melbourne", label: "Melbourne" }, generalLocality] },
      { value: "Other Australian region", label: "General / other state or territory", localities: [generalLocality] },
    ],
  },
  {
    countryCode: "XX",
    label: "General / other country or region",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    adminAreas: [{ value: "General region", label: "General / other state or province", localities: [generalLocality] }],
  },
];

export const CURRENCY_OPTIONS = [
  ["INR", "Indian rupee (INR)"],
  ["AED", "UAE dirham (AED)"],
  ["USD", "US dollar / general international (USD)"],
  ["GBP", "Pound sterling (GBP)"],
  ["CAD", "Canadian dollar (CAD)"],
  ["AUD", "Australian dollar (AUD)"],
  ["EUR", "Euro (EUR)"],
  ["JPY", "Japanese yen (JPY)"],
] as const;

export const LOCALE_OPTIONS = [
  ["en-IN", "English — India (1,23,456)"],
  ["hi-IN", "Hindi — India"],
  ["ml-IN", "Malayalam — India"],
  ["en-AE", "English — UAE"],
  ["ar-AE", "Arabic — UAE"],
  ["en-US", "English — United States / general"],
  ["en-GB", "English — United Kingdom"],
  ["en-CA", "English — Canada"],
  ["fr-CA", "French — Canada"],
  ["en-AU", "English — Australia"],
] as const;

export function regionForCountry(countryCode: string) {
  return REGION_OPTIONS.find((region) => region.countryCode === countryCode) ?? REGION_OPTIONS.at(-1)!;
}

export function adminAreaForRegion(region: RegionOption, adminArea: string) {
  return region.adminAreas.find((option) => option.value === adminArea) ?? region.adminAreas.at(-1)!;
}
