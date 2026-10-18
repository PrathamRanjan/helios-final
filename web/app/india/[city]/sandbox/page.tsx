import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { indiaCityBySlug } from '@/lib/india/cities';
import IndiaUrbanWorkspace from '@/components/india/IndiaUrbanWorkspace';
export function generateMetadata({params}:{params:{city:string}}):Metadata {
 const city=indiaCityBySlug(params.city);
 return {title:city?`HELIOS ${city.name} — Urban Sandbox`:'HELIOS — City not found',description:'Test urban shade, cool roofs and water scenarios in an interactive sustainability sandbox.'};
}
export default function IndiaSandboxPage({params}:{params:{city:string}}){
 const city=indiaCityBySlug(params.city);if(!city)notFound();return <IndiaUrbanWorkspace key={city.slug} city={city}/>;
}
