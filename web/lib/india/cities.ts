import { withinBounds, type Bounds } from './geometry';
export interface IndiaCity {
  slug: string; name: string; region: string; searchLabel: string;
  center: {lat:number;lng:number}; bounds: Bounds; guidance: string;
}
// Product screening extents, not administrative boundaries or claims of Solar coverage.
export const INDIA_CITIES: IndiaCity[] = [
  {slug:'bengaluru',name:'Bengaluru',region:'Karnataka',searchLabel:'Bengaluru',center:{lat:12.9716,lng:77.5946},bounds:{south:12.75,north:13.25,west:77.35,east:77.85},guidance:'Check the applicable BESCOM tariff and rooftop-solar agreement against your electricity bill.'},
  {slug:'delhi-ncr',name:'Delhi NCR',region:'Delhi · Haryana · Uttar Pradesh',searchLabel:'Delhi NCR',center:{lat:28.6139,lng:77.209},bounds:{south:28.25,north:28.90,west:76.80,east:77.65},guidance:'This screening region includes Delhi and nearby NCR centres, not the entire statutory NCR. Select the state and distribution company on your bill; rules differ across the region.'},
  {slug:'mumbai',name:'Mumbai',region:'Maharashtra',searchLabel:'Mumbai',center:{lat:19.076,lng:72.8777},bounds:{south:18.85,north:19.4,west:72.75,east:73.2},guidance:'The metropolitan region has multiple electricity suppliers. Use the distribution company and tariff category on your bill.'},
  {slug:'hyderabad',name:'Hyderabad',region:'Telangana',searchLabel:'Hyderabad',center:{lat:17.385,lng:78.4867},bounds:{south:17.15,north:17.65,west:78.15,east:78.75},guidance:'Select Telangana and your electricity distribution company in the national rooftop portal. Verify the applicable tariff and export agreement.'},
  {slug:'chennai',name:'Chennai',region:'Tamil Nadu',searchLabel:'Chennai',center:{lat:13.0827,lng:80.2707},bounds:{south:12.75,north:13.3,west:79.95,east:80.35},guidance:'Select Tamil Nadu and the distribution company on your bill. Check the current rooftop-solar metering and export terms before assuming compensation.'},
  {slug:'kolkata',name:'Kolkata',region:'West Bengal',searchLabel:'Kolkata',center:{lat:22.5726,lng:88.3639},bounds:{south:22.3,north:22.85,west:88.1,east:88.65},guidance:'Check your actual electricity supplier: utility service areas differ across the metropolitan region. Verify the applicable rooftop-solar agreement.'},
  {slug:'pune',name:'Pune',region:'Maharashtra',searchLabel:'Pune',center:{lat:18.5204,lng:73.8567},bounds:{south:18.3,north:18.8,west:73.6,east:74.1},guidance:'Select Maharashtra and the distribution company on your bill. Use your tariff category and installer quotation for the financial scenario.'},
  {slug:'ahmedabad',name:'Ahmedabad',region:'Gujarat',searchLabel:'Ahmedabad',center:{lat:23.0225,lng:72.5714},bounds:{south:22.8,north:23.3,west:72.35,east:72.85},guidance:'Select Gujarat and your actual electricity supplier. Service areas and rooftop-solar agreement terms can differ across the metropolitan region.'},
];
export const indiaCityBySlug = (slug: string) => INDIA_CITIES.find(c=>c.slug===slug);
export const inCity = (city: IndiaCity, lat:number,lng:number) => withinBounds(city.bounds,lat,lng);
export const BENGALURU = INDIA_CITIES[0];
