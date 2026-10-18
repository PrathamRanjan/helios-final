import { NextRequest } from 'next/server';
import { GET as getUrban, POST as postUrban } from '../../[city]/urban/route';
export const runtime='nodejs';
export const maxDuration=45;
export const GET=(req:NextRequest)=>getUrban(req,{params:{city:'bengaluru'}});
export const POST=(req:NextRequest)=>postUrban(req,{params:{city:'bengaluru'}});
