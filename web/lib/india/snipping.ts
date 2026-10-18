import type { RoofPoint } from './geometry';
export interface ScreenPoint { x:number;y:number }
interface ScreenSize { width:number;height:number }
export function snipRectangle(start:ScreenPoint,end:ScreenPoint,size:ScreenSize) {
 if(![start.x,start.y,end.x,end.y,size.width,size.height].every(Number.isFinite)||size.width<=0||size.height<=0)throw new Error('Invalid map selection coordinates.');
 const clamp=(n:number,max:number)=>Math.max(0,Math.min(n,max));
 const x1=clamp(start.x,size.width),x2=clamp(end.x,size.width),y1=clamp(start.y,size.height),y2=clamp(end.y,size.height);
 return {left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)};
}
export function snipCorners(start:ScreenPoint,end:ScreenPoint,size:ScreenSize,project:(point:ScreenPoint)=>RoofPoint) {
 const r=snipRectangle(start,end,size);
 if(r.width<6||r.height<6)throw new Error('Drag across an area to select it; a single click does not create a selection.');
 return [{x:r.left,y:r.top},{x:r.left+r.width,y:r.top},{x:r.left+r.width,y:r.top+r.height},{x:r.left,y:r.top+r.height}].map(project);
}
