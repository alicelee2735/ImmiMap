/**
 * @deprecated Do not run. This writes the original synthetic 80-org seed and
 * would restore stale listings (CRLA Sacramento at 828 J St, IIBA at 657
 * Mission, BDS at 160 Schermerhorn, Centro at International Blvd).
 *
 * Refresh the static catalog from the live table instead:
 *   npm run db:export-catalog
 *
 * See docs/manual-data-corrections.md.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

throw new Error(
  "scripts/generate-expansion-orgs.mjs is retired. Run npm run db:export-catalog instead.",
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", "src/data/services-expansion.json");

const SERVICE_POOLS = {
  ngo: [
    ["Asylum", "Family", "Citizenship"],
    ["DACA", "TPS", "Family"],
    ["Removal Defense", "Asylum", "Humanitarian Relief"],
    ["Family", "Citizenship", "DACA"],
    ["Asylum", "Humanitarian Relief", "Family"],
    ["Family", "Employment", "Citizenship"],
    ["DACA", "Family", "Citizenship", "TPS"],
    ["Removal Defense", "Family", "Asylum"],
  ],
  firm: [
    ["Employment", "Family", "Citizenship"],
    ["Family", "Removal Defense", "Employment"],
    ["Employment", "Family", "Citizenship", "Removal Defense"],
  ],
};

const INTAKE = ["OPEN", "LIMITED", "WAITLISTED"];
const PRICING = { NGO: ["Pro bono", "Low-cost"], "Law Firm": ["Paid", "Low-cost"] };
const IMAGES = [
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1497366412874-3415097a27e7?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80",
];

const LANGUAGE_SETS = [
  ["English", "Spanish"],
  ["English", "Mandarin", "Cantonese"],
  ["English", "Spanish", "Portuguese"],
  ["English", "Spanish", "Haitian Creole"],
  ["English", "Arabic", "Spanish"],
  ["English", "Vietnamese", "Spanish"],
  ["English", "Korean", "Spanish"],
  ["English", "Spanish", "French"],
];

/** @type {Array<{slug:string,name:string,type:"NGO"|"Law Firm",state:string,city:string,address:string,lat:number,lng:number,website:string,description:string,catchmentNote:string}>} */
const ORGS = [
  // California (16)
  { slug: "carecen-la", name: "Central American Resource Center of Los Angeles", type: "NGO", state: "CA", city: "Los Angeles", address: "2845 W 7th St, Los Angeles, CA 90005", lat: 34.0572, lng: -118.2841, website: "https://www.carecen-la.org", description: "Community-based legal services for Central American and immigrant families in Los Angeles.", catchmentNote: "Serves Los Angeles County." },
  { slug: "esperanza-la", name: "Esperanza Immigrant Rights Project", type: "NGO", state: "CA", city: "Los Angeles", address: "1530 James M Wood Blvd, Los Angeles, CA 90015", lat: 34.0521, lng: -118.2788, website: "https://www.esperanza-la.org", description: "Catholic-affiliated legal services for low-income immigrants facing detention and deportation.", catchmentNote: "Priority for residents of Los Angeles County." },
  { slug: "public-counsel", name: "Public Counsel", type: "NGO", state: "CA", city: "Los Angeles", address: "610 S Ardmore Ave, Los Angeles, CA 90005", lat: 34.0634, lng: -118.3007, website: "https://www.publiccounsel.org", description: "Pro bono law firm serving vulnerable communities through immigration and civil legal aid.", catchmentNote: "Serves clients across Southern California." },
  { slug: "immdef", name: "Immigrant Defenders Law Center", type: "NGO", state: "CA", city: "Los Angeles", address: "634 S Spring St, Los Angeles, CA 90014", lat: 34.0458, lng: -118.2517, website: "https://www.immdef.org", description: "Nonprofit removal defense and asylum representation for detained and non-detained clients.", catchmentNote: "California statewide with focus on Southern California." },
  { slug: "centro-legal-raza", name: "Centro Legal de la Raza", type: "NGO", state: "CA", city: "Oakland", address: "3400 International Blvd, Oakland, CA 94601", lat: 37.7741, lng: -122.2182, website: "https://www.centrolegal.org", description: "Oakland-based immigrant rights organization providing legal services and community education.", catchmentNote: "Primarily Alameda and Contra Costa counties." },
  { slug: "east-bay-sanctuary", name: "East Bay Sanctuary Covenant", type: "NGO", state: "CA", city: "Berkeley", address: "2362 Bancroft Way, Berkeley, CA 94704", lat: 37.8682, lng: -122.2565, website: "https://eastbaysanctuary.org", description: "Faith-based sanctuary organization supporting asylum seekers and refugees in the East Bay.", catchmentNote: "Serves the San Francisco East Bay region." },
  { slug: "iiba-sf", name: "International Institute of the Bay Area", type: "NGO", state: "CA", city: "San Francisco", address: "657 Mission St, San Francisco, CA 94105", lat: 37.7863, lng: -122.4012, website: "https://www.iibayarea.org", description: "Immigrant integration services including legal screenings, citizenship, and family petitions.", catchmentNote: "Serves the San Francisco Bay Area." },
  { slug: "canal-alliance", name: "Canal Alliance", type: "NGO", state: "CA", city: "San Rafael", address: "91 Larkspur St, San Rafael, CA 94901", lat: 37.9728, lng: -122.5251, website: "https://www.canalalliance.org", description: "Marin County immigrant services hub offering legal aid, education, and economic opportunity programs.", catchmentNote: "Primarily serves Marin County." },
  { slug: "siren-sj", name: "Services, Immigrant Rights & Education Network", type: "NGO", state: "CA", city: "San Jose", address: "1415 Koll Cir, San Jose, CA 95112", lat: 37.3606, lng: -121.8987, website: "https://www.siren-bayarea.org", description: "Advocacy and legal navigation for immigrant workers and families in Silicon Valley.", catchmentNote: "Serves Santa Clara County and surrounding areas." },
  { slug: "catholic-charities-sj", name: "Catholic Charities of Santa Clara County", type: "NGO", state: "CA", city: "San Jose", address: "2625 Zanker Rd, San Jose, CA 95134", lat: 37.3965, lng: -121.9284, website: "https://www.catholiccharitiesscc.org", description: "Diocesan legal immigration program offering screenings, DACA, and citizenship assistance.", catchmentNote: "Serves Santa Clara County." },
  { slug: "crla-sacramento", name: "California Rural Legal Assistance Sacramento", type: "NGO", state: "CA", city: "Sacramento", address: "828 J St, Sacramento, CA 95814", lat: 38.5816, lng: -121.4944, website: "https://www.crla.org", description: "Statewide rural legal aid program with a Sacramento office serving farmworkers and immigrants.", catchmentNote: "Northern California and Central Valley." },
  { slug: "mixtec-fresno", name: "Mixtec Indigenous Community Organization Project", type: "NGO", state: "CA", city: "Fresno", address: "601 Van Ness Ave, Fresno, CA 93721", lat: 36.7378, lng: -119.7871, website: "https://www.mixteco.org", description: "Indigenous immigrant community organization providing legal navigation and language access.", catchmentNote: "Central Valley farmworker communities." },
  { slug: "ufw-foundation", name: "UFW Foundation", type: "NGO", state: "CA", city: "Bakersfield", address: "327 E St, Bakersfield, CA 93304", lat: 35.3733, lng: -119.0187, website: "https://www.ufwfoundation.org", description: "Farmworker advocacy organization offering immigration legal services and community education.", catchmentNote: "Serves agricultural workers in Kern County." },
  { slug: "sb-community-service", name: "San Bernardino Community Service Center", type: "NGO", state: "CA", city: "San Bernardino", address: "796 E Rialto Ave, San Bernardino, CA 92410", lat: 34.1083, lng: -117.2898, website: "https://www.sbcsc.org", description: "Inland Empire nonprofit providing immigration legal aid and social services.", catchmentNote: "San Bernardino and Riverside counties." },
  { slug: "legal-aid-foundation-la", name: "Legal Aid Foundation of Los Angeles", type: "NGO", state: "CA", city: "Los Angeles", address: "1550 W 8th St, Los Angeles, CA 90017", lat: 34.0532, lng: -118.2769, website: "https://www.lafla.org", description: "Large civil legal aid provider with dedicated immigration units across Los Angeles.", catchmentNote: "Los Angeles County residents meeting income guidelines." },
  { slug: "pacific-immigration-law", name: "Pacific Immigration Law Group", type: "Law Firm", state: "CA", city: "San Francisco", address: "50 California St, San Francisco, CA 94111", lat: 37.7936, lng: -122.3965, website: "https://www.pacificimmigration.com", description: "San Francisco immigration practice focused on employment visas and family-based petitions.", catchmentNote: "Bay Area and nationwide corporate immigration." },

  // Texas (16)
  { slug: "raices-sa", name: "RAICES San Antonio", type: "NGO", state: "TX", city: "San Antonio", address: "802 N Main Ave, San Antonio, TX 78212", lat: 29.4419, lng: -98.5003, website: "https://www.raicestexas.org", description: "Statewide immigration legal services nonprofit with a major San Antonio office.", catchmentNote: "Serves South and Central Texas." },
  { slug: "las-americas-el-paso", name: "Las Americas Immigrant Advocacy Center", type: "NGO", state: "TX", city: "El Paso", address: "1500 E Yandell Dr, El Paso, TX 79903", lat: 31.7841, lng: -106.4512, website: "https://www.las-americas.org", description: "Border-region legal services for asylum seekers, victims of violence, and detained immigrants.", catchmentNote: "El Paso and West Texas border communities." },
  { slug: "catholic-charities-fw", name: "Catholic Charities Fort Worth Immigration Services", type: "NGO", state: "TX", city: "Fort Worth", address: "249 W Thornhill Dr, Fort Worth, TX 76115", lat: 32.6782, lng: -97.3328, website: "https://www.catholiccharitiesfortworth.org", description: "Diocesan immigration legal program serving Tarrant County families.", catchmentNote: "Primarily Tarrant and surrounding counties." },
  { slug: "hilsc-houston", name: "Houston Immigration Legal Services Collaborative", type: "NGO", state: "TX", city: "Houston", address: "3303 Main St, Houston, TX 77002", lat: 29.7408, lng: -95.3762, website: "https://www.houstonimmigration.org", description: "Coalition coordinating pro bono immigration legal services across Greater Houston.", catchmentNote: "Harris County and Greater Houston area." },
  { slug: "ymca-houston", name: "YMCA International Services Houston", type: "NGO", state: "TX", city: "Houston", address: "6300 Chimney Rock Rd, Houston, TX 77081", lat: 29.6898, lng: -95.4627, website: "https://www.ymcahouston.org", description: "Refugee resettlement and immigration legal services for Houston's newcomer communities.", catchmentNote: "Greater Houston metropolitan area." },
  { slug: "probar-brownsville", name: "ProBAR South Texas", type: "NGO", state: "TX", city: "Brownsville", address: "2606 E 14th St, Brownsville, TX 78521", lat: 25.9148, lng: -97.4681, website: "https://www.probar.org", description: "American Bar Association-affiliated legal aid serving detained immigrants in South Texas.", catchmentNote: "Rio Grande Valley and South Texas detention facilities." },
  { slug: "jfon-dallas", name: "Justice for Our Neighbors North Texas", type: "NGO", state: "TX", city: "Dallas", address: "901 N Polk St, Dallas, TX 75204", lat: 32.8075, lng: -96.8001, website: "https://www.jfonntx.org", description: "UMC-affiliated low-cost immigration legal services clinic in North Texas.", catchmentNote: "Dallas-Fort Worth metroplex." },
  { slug: "catholic-charities-dallas", name: "Catholic Charities Dallas Immigration Services", type: "NGO", state: "TX", city: "Dallas", address: "1421 W Mockingbird Ln, Dallas, TX 75247", lat: 32.8187, lng: -96.8726, website: "https://www.ccdallas.org", description: "Diocesan immigration program offering family petitions, DACA, and citizenship support.", catchmentNote: "Dallas and surrounding North Texas counties." },
  { slug: "rst-austin", name: "Refugee Services of Texas Austin", type: "NGO", state: "TX", city: "Austin", address: "500 E St Johns Ave, Austin, TX 78752", lat: 30.3369, lng: -97.7211, website: "https://www.rstx.org", description: "Refugee resettlement agency with immigration legal navigation and case support.", catchmentNote: "Central Texas including Travis County." },
  { slug: "equal-justice-center", name: "Equal Justice Center", type: "NGO", state: "TX", city: "Austin", address: "510 S Congress Ave, Austin, TX 78704", lat: 30.2565, lng: -97.7467, website: "https://www.equaljusticecenter.org", description: "Workers' rights nonprofit representing low-wage immigrant workers in legal matters.", catchmentNote: "Texas statewide with Austin headquarters." },
  { slug: "laredo-legal-aid", name: "Laredo Immigrant Rights Clinic", type: "NGO", state: "TX", city: "Laredo", address: "1701 Victoria St, Laredo, TX 78040", lat: 27.5036, lng: -99.5075, website: "https://www.laredoimmigrantrights.org", description: "Border community legal clinic serving asylum seekers and mixed-status families.", catchmentNote: "Webb County and border corridor." },
  { slug: "sa-legal-aid", name: "Texas RioGrande Legal Aid San Antonio", type: "NGO", state: "TX", city: "San Antonio", address: "1111 N Main Ave, San Antonio, TX 78212", lat: 29.4442, lng: -98.4968, website: "https://www.trla.org", description: "Regional legal aid provider with immigration services for low-income South Texas residents.", catchmentNote: "Southwest Texas including Bexar County." },
  { slug: "workers-defense", name: "Workers Defense Project", type: "NGO", state: "TX", city: "Austin", address: "5604 Manor Rd, Austin, TX 78723", lat: 30.2987, lng: -97.6861, website: "https://www.workersdefense.org", description: "Immigrant worker advocacy organization with legal support and community organizing.", catchmentNote: "Austin, Dallas, and Houston areas." },
  { slug: "diocese-corpu-christi", name: "Catholic Charities Corpus Christi Immigration", type: "NGO", state: "TX", city: "Corpus Christi", address: "615 Oliver Ct, Corpus Christi, TX 78408", lat: 27.7631, lng: -97.4201, website: "https://catholiccharities-cc.org/immigration", description: "Coastal Texas diocesan immigration services for families and asylum seekers.", catchmentNote: "Coastal Bend and surrounding counties." },
  { slug: "el-paso-catholic-charities", name: "Catholic Charities El Paso Immigration Program", type: "NGO", state: "TX", city: "El Paso", address: "2400 E Yandell Dr, El Paso, TX 79903", lat: 31.7855, lng: -106.4421, website: "https://www.ccep.org", description: "Border diocese immigration services including humanitarian parole and family reunification.", catchmentNote: "El Paso and Southern New Mexico." },
  { slug: "lonestar-immigration-law", name: "Lone Star Immigration Law Firm", type: "Law Firm", state: "TX", city: "Houston", address: "1200 Smith St, Houston, TX 77002", lat: 29.7568, lng: -95.3698, website: "https://www.lonestarimmigrationlaw.com", description: "Houston-based immigration practice for employment, family, and removal defense cases.", catchmentNote: "Greater Houston and Gulf Coast region." },

  // Florida (16)
  { slug: "legal-aid-broward", name: "Legal Aid Service of Broward County", type: "NGO", state: "FL", city: "Fort Lauderdale", address: "491 N State Rd 7, Fort Lauderdale, FL 33317", lat: 26.1193, lng: -80.1434, website: "https://www.legalaid.org", description: "Civil legal aid provider with immigration units serving low-income Broward residents.", catchmentNote: "Broward County." },
  { slug: "florida-immigrant-coalition", name: "Florida Immigrant Coalition", type: "NGO", state: "FL", city: "Miami", address: "2800 Biscayne Blvd, Miami, FL 33137", lat: 25.8134, lng: -80.1892, website: "https://www.floridaimmigrant.org", description: "Statewide immigrant rights coalition offering legal navigation and advocacy.", catchmentNote: "Florida statewide with Miami headquarters." },
  { slug: "lutheran-services-fl", name: "Lutheran Services Florida Immigration Services", type: "NGO", state: "FL", city: "Tampa", address: "3627 W Waters Ave, Tampa, FL 33614", lat: 28.0253, lng: -82.5031, website: "https://www.lsfnet.org", description: "Refugee and immigrant services including legal screenings and case assistance.", catchmentNote: "Tampa Bay and Central Florida." },
  { slug: "catholic-charities-orlando", name: "Catholic Charities Orlando Immigration Services", type: "NGO", state: "FL", city: "Orlando", address: "1771 N Semoran Blvd, Orlando, FL 32807", lat: 28.5672, lng: -81.3081, website: "https://www.cflcc.org", description: "Central Florida diocesan immigration program for families and DACA recipients.", catchmentNote: "Orange, Osceola, and Seminole counties." },
  { slug: "legal-services-north-fl", name: "Legal Services of North Florida", type: "NGO", state: "FL", city: "Tallahassee", address: "2119 N Monroe St, Tallahassee, FL 32303", lat: 30.4648, lng: -84.2806, website: "https://www.lsnf.org", description: "Regional legal aid with immigration services for low-income North Florida residents.", catchmentNote: "North Florida and Panhandle counties." },
  { slug: "jfon-jacksonville", name: "Justice for Our Neighbors Northeast Florida", type: "NGO", state: "FL", city: "Jacksonville", address: "4000 St Augustine Rd, Jacksonville, FL 32207", lat: 30.2821, lng: -81.6378, website: "https://www.jfonflorida.org", description: "Low-cost immigration legal clinic serving Northeast Florida immigrant families.", catchmentNote: "Duval and surrounding Northeast Florida counties." },
  { slug: "hispanic-unity-fl", name: "Hispanic Unity of Florida", type: "NGO", state: "FL", city: "Hollywood", address: "5840 Johnson St, Hollywood, FL 33021", lat: 26.0225, lng: -80.2078, website: "https://www.hispanicunity.org", description: "South Florida immigrant services organization with legal navigation and citizenship programs.", catchmentNote: "Broward County." },
  { slug: "farmworker-association", name: "Farmworker Association of Florida", type: "NGO", state: "FL", city: "Apopka", address: "815 S Hawthorne Ave, Apopka, FL 32703", lat: 28.6648, lng: -81.5156, website: "https://www.floridafarmworkers.org", description: "Farmworker advocacy organization with immigration legal support and worker rights education.", catchmentNote: "Central Florida agricultural communities." },
  { slug: "gulf-coast-jfs", name: "Gulf Coast Jewish Family Services", type: "NGO", state: "FL", city: "Clearwater", address: "14041 Icot Blvd, Clearwater, FL 33760", lat: 27.9186, lng: -82.7193, website: "https://www.gulfcoastjfcs.org", description: "Refugee and immigrant services including legal screenings and resettlement support.", catchmentNote: "Pinellas and Pasco counties." },
  { slug: "bridge-love-tampa", name: "Bridge of Love and Hope Foundation", type: "NGO", state: "FL", city: "Tampa", address: "5105 N Armenia Ave, Tampa, FL 33603", lat: 27.9901, lng: -82.5089, website: "https://www.bridgeoflovehope.org", description: "Community nonprofit providing immigration legal navigation for Tampa Bay families.", catchmentNote: "Hillsborough County." },
  { slug: "university-miami-clinic", name: "University of Miami Immigration Clinic", type: "NGO", state: "FL", city: "Miami", address: "1311 Miller Dr, Coral Gables, FL 33146", lat: 25.7208, lng: -80.2790, website: "https://www.law.miami.edu", description: "Law school clinic representing immigrants in asylum, TPS, and humanitarian cases.", catchmentNote: "South Florida with case-type restrictions." },
  { slug: "st-thomas-immigration-clinic", name: "St. Thomas University Immigration Clinic", type: "NGO", state: "FL", city: "Miami Gardens", address: "16401 NW 37th Ave, Miami Gardens, FL 33054", lat: 25.9287, lng: -80.2436, website: "https://www.stu.edu", description: "Law school immigration clinic serving low-income clients in South Florida.", catchmentNote: "Miami-Dade County." },
  { slug: "legal-aid-palm-beach", name: "Legal Aid Society of Palm Beach County", type: "NGO", state: "FL", city: "West Palm Beach", address: "423 Fern St, West Palm Beach, FL 33401", lat: 26.7153, lng: -80.0534, website: "https://www.legalaidpbc.org", description: "Civil legal aid with immigration services for eligible Palm Beach County residents.", catchmentNote: "Palm Beach County." },
  { slug: "catholic-charities-miami-beach", name: "Catholic Charities Miami Beach Outreach", type: "NGO", state: "FL", city: "Miami Beach", address: "1400 Biscayne Blvd, Miami, FL 33132", lat: 25.7863, lng: -80.1865, website: "https://www.ccadm.org", description: "Archdiocesan outreach providing immigration screenings and referral services.", catchmentNote: "Miami-Dade County." },
  { slug: "we-count-fl", name: "WeCount Immigrant Rights Center", type: "NGO", state: "FL", city: "Homestead", address: "201 N Krome Ave #240, Homestead, FL 33030", lat: 25.4712, lng: -80.4776, website: "https://www.we-count.org", description: "South Dade immigrant worker center with legal support and community organizing.", catchmentNote: "South Miami-Dade agricultural communities." },
  { slug: "sunshine-immigration-law", name: "Sunshine Immigration Law Group", type: "Law Firm", state: "FL", city: "Miami", address: "1001 Brickell Bay Dr, Miami, FL 33131", lat: 25.7617, lng: -80.1918, website: "https://www.sunshineimmigrationlaw.com", description: "Miami immigration firm handling family, employment, and investor visa matters.", catchmentNote: "South Florida and international clients." },

  // New York (16)
  { slug: "african-services-committee", name: "African Services Committee", type: "NGO", state: "NY", city: "New York", address: "429 W 127th St, New York, NY 10027", lat: 40.8138, lng: -73.9542, website: "https://www.africanservices.org", description: "Harlem-based nonprofit serving African and Caribbean immigrants with legal and health services.", catchmentNote: "New York City metro area." },
  { slug: "sanctuary-for-families", name: "Sanctuary for Families", type: "NGO", state: "NY", city: "New York", address: "PO Box 1406, Wall Street Station, New York, NY 10268", lat: 40.7075, lng: -74.0113, website: "https://www.sanctuaryforfamilies.org", description: "Legal services for immigrant survivors of gender-based violence.", catchmentNote: "New York City." },
  { slug: "catholic-charities-ny", name: "Catholic Charities New York Immigration Services", type: "NGO", state: "NY", city: "New York", address: "1011 First Ave, New York, NY 10022", lat: 40.7561, lng: -73.9645, website: "https://www.catholiccharitiesny.org", description: "Archdiocesan immigration program offering screenings, applications, and referrals.", catchmentNote: "New York City and surrounding counties." },
  { slug: "unlocal-brooklyn", name: "UnLocal", type: "NGO", state: "NY", city: "Brooklyn", address: "456 Southern Blvd, Bronx, NY 10455", lat: 40.8142, lng: -73.9015, website: "https://www.unlocal.org", description: "Immigrant legal services nonprofit serving NYC communities with direct representation.", catchmentNote: "New York City boroughs." },
  { slug: "cala", name: "Central American Legal Assistance", type: "NGO", state: "NY", city: "Brooklyn", address: "91 Atlantic Ave, Brooklyn, NY 11201", lat: 40.6905, lng: -73.9965, website: "https://www.cala-ny.org", description: "Brooklyn nonprofit specializing in Central American asylum and family cases.", catchmentNote: "New York City with Central American community focus." },
  { slug: "safe-passage-project", name: "Safe Passage Project", type: "NGO", state: "NY", city: "New York", address: "225 Broadway, New York, NY 10007", lat: 40.7108, lng: -74.0089, website: "https://www.safepassageproject.org", description: "Legal services for unaccompanied immigrant children in New York.", catchmentNote: "New York City and Long Island." },
  { slug: "city-bar-justice", name: "City Bar Justice Center Immigrant Justice Project", type: "NGO", state: "NY", city: "New York", address: "42 W 44th St, New York, NY 10036", lat: 40.7555, lng: -73.9822, website: "https://www.citybarjusticecenter.org", description: "Pro bono legal services connecting immigrant clients with volunteer attorneys.", catchmentNote: "New York City metropolitan area." },
  { slug: "bronx-legal-services", name: "Bronx Legal Services", type: "NGO", state: "NY", city: "Bronx", address: "349 E 149th St, Bronx, NY 10455", lat: 40.8165, lng: -73.9154, website: "https://www.legalaidnyc.org", description: "Neighborhood legal aid office with immigration services for Bronx residents.", catchmentNote: "Bronx County." },
  { slug: "brooklyn-defender-services", name: "Brooklyn Defender Services Immigration Unit", type: "NGO", state: "NY", city: "Brooklyn", address: "160 Schermerhorn St, Brooklyn, NY 11201", lat: 40.6901, lng: -73.9903, website: "https://www.bds.org", description: "Public defender organization with immigration defense for Brooklyn clients.", catchmentNote: "Brooklyn and NYC." },
  { slug: "nm-cirr", name: "Northern Manhattan Coalition for Immigrant Rights", type: "NGO", state: "NY", city: "New York", address: "5030 Broadway, New York, NY 10034", lat: 40.8687, lng: -73.9213, website: "https://www.cirrny.org", description: "Washington Heights immigrant rights organization with legal services and advocacy.", catchmentNote: "Northern Manhattan and Bronx." },
  { slug: "neighbors-link", name: "Neighbors Link Immigration Legal Services", type: "NGO", state: "NY", city: "Mount Kisco", address: "27 Columbus Ave, Mount Kisco, NY 10549", lat: 41.2043, lng: -73.7268, website: "https://www.neighborslink.org", description: "Westchester nonprofit integrating immigrant families with legal and social services.", catchmentNote: "Westchester County." },
  { slug: "worker-justice-rochester", name: "Worker Justice Center of New York Rochester", type: "NGO", state: "NY", city: "Rochester", address: "118 N Clinton Ave, Rochester, NY 14604", lat: 43.1566, lng: -77.6088, website: "https://www.wjcny.org", description: "Upstate legal advocacy for farmworkers and low-wage immigrant workers.", catchmentNote: "Western and Central New York." },
  { slug: "flushing-workers-center", name: "Flushing Workers Center", type: "NGO", state: "NY", city: "Flushing", address: "133-12 41st Ave, Flushing, NY 11355", lat: 40.7587, lng: -73.8315, website: "https://www.flushingworkers.org", description: "Queens worker center providing immigration legal navigation for Asian immigrant communities.", catchmentNote: "Queens and greater NYC." },
  { slug: "empire-justice", name: "Empire Justice Center Immigration Project", type: "NGO", state: "NY", city: "Albany", address: "1 West St, Albany, NY 12204", lat: 42.6526, lng: -73.7562, website: "https://www.empirejustice.org", description: "Statewide legal advocacy organization with immigration policy and direct services.", catchmentNote: "New York State." },
  { slug: "syracuse-legal-services", name: "Legal Services of Central New York", type: "NGO", state: "NY", city: "Syracuse", address: "221 S Warren St, Syracuse, NY 13202", lat: 43.0481, lng: -76.1545, website: "https://www.lscny.org", description: "Regional legal aid provider with immigration services for Central New York.", catchmentNote: "Onondaga and surrounding Central NY counties." },
  { slug: "hudson-valley-immigration-law", name: "Hudson Valley Immigration Law Associates", type: "Law Firm", state: "NY", city: "White Plains", address: "50 Main St, White Plains, NY 10606", lat: 41.0330, lng: -73.7629, website: "https://www.hudsonvalleyimmigrationlaw.com", description: "Westchester immigration practice for family, employment, and naturalization cases.", catchmentNote: "Hudson Valley and NYC suburbs." },

  // New Jersey (16)
  { slug: "catholic-charities-camden", name: "Catholic Charities Diocese of Camden Immigration", type: "NGO", state: "NJ", city: "Camden", address: "1845 Haddon Ave, Camden, NJ 08103", lat: 39.9254, lng: -75.1196, website: "https://www.catholiccharitiescamden.org", description: "South Jersey diocesan immigration services for families and DACA recipients.", catchmentNote: "Southern New Jersey counties." },
  { slug: "catholic-charities-trenton", name: "Catholic Charities Diocese of Trenton Immigration", type: "NGO", state: "NJ", city: "Trenton", address: "383 W State St, Trenton, NJ 08618", lat: 40.2206, lng: -74.7730, website: "https://www.catholiccharitiestrenton.org", description: "Central Jersey diocesan immigration program offering screenings and applications.", catchmentNote: "Mercer and surrounding Central Jersey counties." },
  { slug: "wind-of-the-spirit", name: "Wind of the Spirit Immigrant Resource Center", type: "NGO", state: "NJ", city: "Morristown", address: "2 Elm St, Morristown, NJ 07960", lat: 40.7968, lng: -74.4815, website: "https://www.windofthespirit.org", description: "Morris County immigrant resource center with legal navigation and community support.", catchmentNote: "Morris County and surrounding areas." },
  { slug: "first-friends-nj", name: "First Friends of New Jersey and New York", type: "NGO", state: "NJ", city: "Kearny", address: "216 Passaic Ave, Kearny, NJ 07032", lat: 40.7684, lng: -74.1454, website: "https://www.firstfriendsnjny.org", description: "Volunteer organization supporting detained immigrants with legal referral services.", catchmentNote: "New Jersey and New York detention facilities." },
  { slug: "vlj-newark", name: "Volunteer Lawyers for Justice Newark", type: "NGO", state: "NJ", city: "Newark", address: "60 Park Pl, Newark, NJ 07102", lat: 40.7357, lng: -74.1724, website: "https://www.vljnj.org", description: "Pro bono legal services connecting low-income NJ residents with volunteer attorneys.", catchmentNote: "Essex County and statewide referrals." },
  { slug: "northeast-legal-services", name: "Northeast New Jersey Legal Services", type: "NGO", state: "NJ", city: "Hackensack", address: "190 Moore St, Hackensack, NJ 07601", lat: 40.8859, lng: -74.0435, website: "https://www.northeastnjlegalservices.org", description: "Regional legal aid with immigration services for Bergen, Hudson, and Passaic counties.", catchmentNote: "Northeast New Jersey." },
  { slug: "somerset-immigration-services", name: "Immigration Services of Somerset County", type: "NGO", state: "NJ", city: "Somerville", address: "27 Warren St, Somerville, NJ 08876", lat: 40.5665, lng: -74.6098, website: "https://www.immigrationservicessomerset.org", description: "County-based nonprofit providing immigration legal screenings and citizenship classes.", catchmentNote: "Somerset County." },
  { slug: "project-rain", name: "Project RAIN Newark", type: "NGO", state: "NJ", city: "Newark", address: "915 Broad St, Newark, NJ 07102", lat: 40.7340, lng: -74.1725, website: "https://www.projectrainnj.org", description: "Newark immigrant advocacy organization with legal support and community education.", catchmentNote: "Essex County." },
  { slug: "latino-action-network", name: "Latino Action Network Foundation", type: "NGO", state: "NJ", city: "New Brunswick", address: "57 Livingston Ave, New Brunswick, NJ 08901", lat: 40.4862, lng: -74.4518, website: "https://www.lanfoundation.org", description: "Latino civil rights organization with immigration legal navigation in Central Jersey.", catchmentNote: "Middlesex and surrounding counties." },
  { slug: "hudson-county-legal-services", name: "Hudson County Legal Services", type: "NGO", state: "NJ", city: "Jersey City", address: "595 Newark Ave, Jersey City, NJ 07306", lat: 40.7348, lng: -74.0641, website: "https://www.hudsoncountylegalservices.org", description: "County legal aid office serving low-income Hudson County immigrants.", catchmentNote: "Hudson County." },
  { slug: "el-centro-hudson", name: "El Centro Hispanoamericano", type: "NGO", state: "NJ", city: "Union City", address: "3800 Bergenline Ave, Union City, NJ 07087", lat: 40.7732, lng: -74.0287, website: "https://www.elcentronj.org", description: "Hudson County Latino community center with immigration legal navigation.", catchmentNote: "Northern Hudson County." },
  { slug: "atlantic-county-legal-aid", name: "Atlantic County Legal Services Immigration Unit", type: "NGO", state: "NJ", city: "Atlantic City", address: "1201 Atlantic Ave, Atlantic City, NJ 08401", lat: 39.3643, lng: -74.4229, website: "https://www.aclegalservices.org", description: "South Jersey legal aid with immigration services for Atlantic County residents.", catchmentNote: "Atlantic County and South Jersey." },
  { slug: "paterson-immigrant-center", name: "Paterson Immigrant Resource Center", type: "NGO", state: "NJ", city: "Paterson", address: "60 Temple St, Paterson, NJ 07501", lat: 40.9168, lng: -74.1718, website: "https://www.patersonimmigrantcenter.org", description: "Passaic County immigrant resource hub with legal screenings and referrals.", catchmentNote: "Passaic County." },
  { slug: "camden-center-immigration", name: "Camden Center for Immigration Services", type: "NGO", state: "NJ", city: "Cherry Hill", address: "1930 Old Cuthbert Rd, Cherry Hill, NJ 08003", lat: 39.9348, lng: -75.0306, website: "https://www.camdenimmigrationcenter.org", description: "South Jersey nonprofit providing immigration legal aid and community workshops.", catchmentNote: "Camden and Burlington counties." },
  { slug: "princeton-immigration-clinic", name: "Princeton Immigration Clinic", type: "NGO", state: "NJ", city: "Princeton", address: "102 Witherspoon St, Princeton, NJ 08542", lat: 40.3495, lng: -74.6593, website: "https://www.princetonimmigrationclinic.org", description: "Community legal clinic serving low-income immigrants in Mercer County.", catchmentNote: "Mercer County." },
  { slug: "garden-state-immigration-law", name: "Garden State Immigration Law Group", type: "Law Firm", state: "NJ", city: "Newark", address: "One Gateway Center, Newark, NJ 07102", lat: 40.7345, lng: -74.1640, website: "https://www.gardenstateimmigrationlaw.com", description: "Newark immigration firm handling family, employment, and removal proceedings.", catchmentNote: "Northern and Central New Jersey." },
];

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const entries = ORGS.map((org, index) => {
  const pool = org.type === "NGO" ? SERVICE_POOLS.ngo : SERVICE_POOLS.firm;
  const services = pool[index % pool.length];
  const pricing = PRICING[org.type][index % PRICING[org.type].length];

  return {
    id: `svc-${org.state.toLowerCase()}-${slugify(org.city)}-${org.slug}`,
    name: org.name,
    type: org.type,
    state: org.state,
    address: org.address,
    latitude: org.lat,
    longitude: org.lng,
    pricing,
    services_offered: services,
    thumbnail_image_url: IMAGES[index % IMAGES.length],
    website: org.website,
    description: org.description,
    intakeStatus: INTAKE[index % INTAKE.length],
    languages: LANGUAGE_SETS[index % LANGUAGE_SETS.length],
    catchmentNote: org.catchmentNote,
  };
});

writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Wrote ${entries.length} organizations to ${outputPath}`);
