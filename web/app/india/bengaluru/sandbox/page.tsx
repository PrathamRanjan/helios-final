import type { Metadata } from 'next';
import IndiaUrbanWorkspace from '@/components/india/IndiaUrbanWorkspace';
import { BENGALURU } from '@/lib/india/cities';
// The static Bengaluru solar segment takes priority over [city].
export const metadata:Metadata={title:'HELIOS Bengaluru — Urban Sandbox',description:'Test shade, cool roofs and water scenarios in Bengaluru.'};
export default function BengaluruUrbanPage(){return <IndiaUrbanWorkspace city={BENGALURU}/>;}
