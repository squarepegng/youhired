// Location eligibility: a deterministic first pass over the exact location wording.
// The AI adds a second opinion from the full description (see score.ts), but a clear
// "US only" here is never overridden into "eligible".

import type { Eligibility, Profile } from "./types.js";

// Region membership for countries. Not exhaustive; unknown countries still match on their own name.
const REGIONS: Record<string, string[]> = {
  africa: [
    "nigeria", "ghana", "kenya", "south africa", "egypt", "morocco", "ethiopia", "uganda", "tanzania", "rwanda",
    "senegal", "cameroon", "cote d'ivoire", "ivory coast", "tunisia", "algeria", "zambia", "zimbabwe", "botswana",
    "namibia", "benin", "togo", "mauritius", "malawi", "mozambique", "angola", "sierra leone", "liberia",
  ],
  europe: [
    "united kingdom", "uk", "ireland", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium",
    "poland", "sweden", "norway", "denmark", "finland", "austria", "switzerland", "czech republic", "czechia",
    "romania", "greece", "hungary", "bulgaria", "croatia", "estonia", "latvia", "lithuania", "slovakia", "slovenia",
    "luxembourg", "serbia", "ukraine", "cyprus", "malta", "iceland",
  ],
  eu: [
    "ireland", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium", "poland", "sweden",
    "denmark", "finland", "austria", "czech republic", "czechia", "romania", "greece", "hungary", "bulgaria",
    "croatia", "estonia", "latvia", "lithuania", "slovakia", "slovenia", "luxembourg", "cyprus", "malta",
  ],
  middle_east: ["united arab emirates", "uae", "saudi arabia", "israel", "turkey", "qatar", "jordan", "lebanon", "bahrain", "oman", "kuwait"],
  north_america: ["united states", "usa", "us", "canada", "mexico"],
  latam: ["mexico", "brazil", "argentina", "colombia", "chile", "peru", "uruguay", "costa rica", "ecuador", "guatemala"],
  apac: [
    "india", "pakistan", "bangladesh", "sri lanka", "philippines", "indonesia", "vietnam", "thailand", "malaysia",
    "singapore", "japan", "south korea", "china", "hong kong", "taiwan", "australia", "new zealand", "nepal",
  ],
};
// Every country name, so "Armenia" or "Brazil" alone is recognised as a restriction.
const ALL_COUNTRIES = [
  "afghanistan", "albania", "algeria", "andorra", "angola", "antigua and barbuda", "argentina", "armenia",
  "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus",
  "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia and herzegovina", "botswana", "brazil",
  "brunei", "bulgaria", "burkina faso", "burundi", "cabo verde", "cambodia", "cameroon", "canada",
  "cape verde", "central african republic", "chad", "chile", "china", "colombia", "comoros", "congo",
  "costa rica", "croatia", "cuba", "cyprus", "czech republic", "czechia", "denmark", "djibouti",
  "dominica", "dominican republic", "ecuador", "egypt", "el salvador", "equatorial guinea", "eritrea", "estonia",
  "eswatini", "ethiopia", "fiji", "finland", "france", "gabon", "gambia", "georgia",
  "germany", "ghana", "greece", "grenada", "guatemala", "guinea", "guinea-bissau", "guyana",
  "haiti", "honduras", "hong kong", "hungary", "iceland", "india", "indonesia", "iran",
  "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan",
  "kenya", "kiribati", "kosovo", "kuwait", "kyrgyzstan", "laos", "latvia", "lebanon",
  "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg", "madagascar", "malawi",
  "malaysia", "maldives", "mali", "malta", "marshall islands", "mauritania", "mauritius", "mexico",
  "micronesia", "moldova", "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar",
  "namibia", "nauru", "nepal", "netherlands", "new zealand", "nicaragua", "niger", "nigeria",
  "north korea", "north macedonia", "norway", "oman", "pakistan", "palau", "palestine", "panama",
  "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "puerto rico", "qatar",
  "romania", "russia", "rwanda", "saint lucia", "samoa", "san marino", "saudi arabia", "senegal",
  "serbia", "seychelles", "sierra leone", "singapore", "slovakia", "slovenia", "solomon islands", "somalia",
  "south africa", "south korea", "south sudan", "spain", "sri lanka", "sudan", "suriname", "sweden",
  "switzerland", "syria", "taiwan", "tajikistan", "tanzania", "thailand", "timor-leste", "togo",
  "tonga", "trinidad and tobago", "tunisia", "turkey", "turkiye", "turkmenistan", "tuvalu", "uganda",
  "ukraine", "united arab emirates", "uruguay", "uzbekistan", "vanuatu", "vatican", "venezuela", "vietnam",
  "yemen", "zambia", "zimbabwe",
];

REGIONS.emea = [...REGIONS.europe, ...REGIONS.middle_east, ...REGIONS.africa];
REGIONS.americas = [...new Set([...REGIONS.north_america, ...REGIONS.latam])];

const REGION_WORDS: [RegExp, string][] = [
  [/\bemea\b/, "emea"],
  [/\b(?:europe|european)\b/, "europe"],
  [/\b(?:eu|european union|eea)\b/, "eu"],
  [/\bafrica(?:n)?\b/, "africa"],
  [/\bmiddle east\b|\bmena\b/, "middle_east"],
  [/\bnorth america\b/, "north_america"],
  [/\b(?:latam|latin america|south america)\b/, "latam"],
  [/\bamericas\b/, "americas"],
  [/\b(?:apac|asia[- ]pacific|asia)\b/, "apac"],
];

const COUNTRY_ALIASES: [RegExp, string][] = [
  [/(?<![\w.])(?:us|u\.s\.(?:a\.)?|usa|united states|america)(?![\w])(?! ?(?:dollars?|\$))/, "united states"],
  [/\b(?:uk|u\.k\.|united kingdom|britain|england|scotland)\b/, "united kingdom"],
  [/\bcanada\b/, "canada"],
  [/\buae\b|\bunited arab emirates\b|\bdubai\b/, "united arab emirates"],
];

const WORLDWIDE =
  /\b(?:worldwide|world ?wide|anywhere(?: in the world)?|global(?:ly)?|work from anywhere|all countries|any (?:country|location)|fully remote,? (?:anywhere|global)|remote[- ]first,? anywhere|international)\b/;
const ONLY = /\b(?:only|must (?:be|reside|live)|required to (?:be|reside|live)|based in|residents? of|located in|within)\b/;
const CONTRACTOR = /\b(?:contractors?|contract basis|independent contractor|deel|remote\.com|oyster|freelance)\b/;

/** Rough UTC offset per country, used for timezone-window postings like "UTC-2 to UTC+3". */
const TZ: Record<string, number> = {
  nigeria: 1, ghana: 0, kenya: 3, "south africa": 2, egypt: 2, morocco: 1, "united kingdom": 0, germany: 1,
  france: 1, spain: 1, portugal: 0, poland: 1, india: 5.5, pakistan: 5, philippines: 8, brazil: -3,
  argentina: -3, mexico: -6, "united states": -5, canada: -5, "united arab emirates": 4,
};

export function normCountry(c: string): string {
  const s = c.trim().toLowerCase();
  for (const [re, name] of COUNTRY_ALIASES) if (re.test(s)) return name;
  return s;
}

// Common cities/states that imply a country when the posting gives no country name.
const PLACES: [RegExp, string][] = [
  [/\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|wisconsin|wyoming)\b/, "united states"],
  [/\b(?:san francisco|new york|nyc|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington,? dc|bay area|silicon valley)\b|,\s?(?:ca|ny|tx|wa|ma|co|il|fl|ga)\b/, "united states"],
  [/\b(?:london|manchester|edinburgh)\b/, "united kingdom"],
  [/\b(?:toronto|vancouver|montreal)\b/, "canada"],
  [/\b(?:berlin|munich|hamburg)\b/, "germany"],
  [/\b(?:paris)\b/, "france"],
  [/\b(?:amsterdam)\b/, "netherlands"],
  [/\b(?:lagos|abuja)\b/, "nigeria"],
  [/\b(?:nairobi)\b/, "kenya"],
  [/\b(?:bangalore|bengaluru|mumbai|delhi|hyderabad)\b/, "india"],
];

function countriesIn(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const found = new Set<string>();
  for (const [re, name] of PLACES) if (re.test(t)) found.add(name);
  for (const [re, name] of COUNTRY_ALIASES) if (re.test(t)) found.add(name);
  const all = new Set([...Object.values(REGIONS).flat(), ...ALL_COUNTRIES]);
  for (const c of all) {
    if (c.length <= 3) continue; // "us", "uk", "uae" handled by aliases
    if (new RegExp(`\\b${c.replace(/[.']/g, "\\$&")}\\b`).test(t)) found.add(c);
  }
  return [...found];
}

function regionsIn(text: string): string[] {
  // "South Africa" is a country, not the Africa region; same for "Central African Republic".
  const t = text.toLowerCase().replace(/south africa|central african republic/g, " ");
  return REGION_WORDS.filter(([re]) => re.test(t)).map(([, r]) => r);
}

function utcWindow(text: string): [number, number] | null {
  const m = text.match(/(?:utc|gmt)\s*([+-−]\s*\d{1,2}(?::?30)?)\s*(?:to|-|–|and|through)\s*(?:utc|gmt)?\s*([+-−]\s*\d{1,2}(?::?30)?)/i);
  if (!m) return null;
  const n = (s: string) => parseFloat(s.replace(/\s/g, "").replace("−", "-").replace(":30", ".5"));
  const a = n(m[1]);
  const b = n(m[2]);
  return [Math.min(a, b), Math.max(a, b)];
}

/** Countries the candidate can legally work in without sponsorship. */
export function allowedCountries(p: Pick<Profile, "country" | "workAuth">): Set<string> {
  const set = new Set<string>();
  if (p.country) set.add(normCountry(p.country));
  for (const [c, st] of Object.entries(p.workAuth ?? {})) if (st === "citizen" || st === "authorized") set.add(normCountry(c));
  return set;
}

export function checkLocation(
  locationText: string,
  p: Pick<Profile, "country" | "workAuth" | "openToContractor" | "timezone">,
  extraText = "",
): Eligibility {
  const loc = (locationText || "").trim();
  const lower = loc.toLowerCase();
  const allowed = allowedCountries(p);
  const home = normCountry(p.country || "");
  if (!home) return { verdict: "unclear", reason: "Add your country of residence in Profile.", evidence: loc };

  const regionsOk = (regions: string[]) =>
    regions.filter((r) => [...allowed].some((c) => REGIONS[r]?.includes(c)));

  const mentioned = countriesIn(lower);
  const regions = regionsIn(lower);
  const okRegions = regionsOk(regions);
  const okCountries = mentioned.filter((c) => allowed.has(c));

  // On-site or hybrid roles with no remote option need you in the office.
  if (/\b(?:on-?site|in[- ]office|hybrid|in[- ]person)\b/.test(lower) && !/\bremote\b/.test(lower) && !okCountries.length)
    return { verdict: "ineligible", reason: "On-site or hybrid role, not remote.", evidence: loc };
  if (okCountries.length) return { verdict: "eligible", reason: `Open to ${okCountries.join(", ")}.`, evidence: loc };
  if (okRegions.length) return { verdict: "eligible", reason: `Open to ${okRegions.join(", ").toUpperCase()}, which includes ${home}.`, evidence: loc };

  if (WORLDWIDE.test(lower) && !(ONLY.test(lower) && (mentioned.length || regions.length))) {
    return { verdict: "eligible", reason: "Open worldwide.", evidence: loc };
  }

  const win = utcWindow(`${loc} ${extraText}`);
  const off = TZ[home];
  if (win && off !== undefined) {
    const ok = off >= win[0] && off <= win[1];
    return {
      verdict: ok ? "eligible" : "ineligible",
      reason: ok ? `Your timezone (UTC${off >= 0 ? "+" : ""}${off}) is inside the hiring window.` : `Your timezone is outside the hiring window.`,
      evidence: loc || `UTC${win[0]} to UTC${win[1]}`,
    };
  }

  if (mentioned.length || regions.length) {
    const where = [...mentioned, ...regions.map((r) => r.toUpperCase())].join(", ");
    if (CONTRACTOR.test(lower) && p.openToContractor && WORLDWIDE.test(lower))
      return { verdict: "eligible", reason: "Contractors accepted worldwide.", evidence: loc };
    return { verdict: "ineligible", reason: `Limited to ${where}; you are in ${home} without work authorisation there.`, evidence: loc };
  }

  if (/^remote$/i.test(loc) || /^remote\b/i.test(loc) || !loc) {
    return { verdict: "unclear", reason: "Says remote but doesn't say where. The description decides.", evidence: loc || "(no location given)" };
  }
  return { verdict: "unclear", reason: "Location wording not recognised.", evidence: loc };
}
