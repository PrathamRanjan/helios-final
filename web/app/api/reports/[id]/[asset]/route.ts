import {NextRequest,NextResponse} from 'next/server';
import {readReportAsset,reportLocation,REPORT_TYPES} from '@/lib/cloud/reports';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string;asset:string}}){
 try{reportLocation(params.id,params.asset);}catch{return NextResponse.json({error:'Invalid report asset.'},{status:400});}
 const bytes=await readReportAsset(params.id,params.asset);
 if(!bytes)return NextResponse.json({error:'Report asset not found.'},{status:404});
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':REPORT_TYPES[params.asset],'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
