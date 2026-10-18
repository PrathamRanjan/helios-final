// Singapore traffic meshes. Metres; +Y forward, +Z up; tyre contact z=0.
// Vehicle liveries are vertex colours; vehicle mesh layers must use white instance colour.
import { Geometry } from "@luma.gl/engine";
type V = [number, number, number];
type Box = [number, number, number, number, number, number];
const PAINT: V = [0.91, 0.92, 0.93], GLASS: V = [0.075, 0.12, 0.16];
const RUBBER: V = [0.045, 0.05, 0.06], METAL: V = [0.48, 0.53, 0.59];
const LIGHT: V = [1, 0.98, 0.83], DARK: V = [0.12, 0.14, 0.17];
class Mesh {
  p: number[] = []; n: number[] = []; c: number[] = []; uv: number[] = [];
  face(points: V[], color: V = PAINT) {
    const a = points[0], b = points[1], c = points[2];
    const u = b.map((v, i) => v-a[i]), v = c.map((v, i) => v-a[i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) return;
    for(let i=1;i<points.length-1;i++) for(const q of [points[0],points[i],points[i+1]]) {
      this.p.push(...q); this.n.push(...n.map(x=>x/len)); this.c.push(...color); this.uv.push(0,0);
    }
  }
  box(x:number,y:number,z:number,w:number,l:number,h:number,color:V=PAINT) {
    const a=x-w/2,b=x+w/2,c=y-l/2,d=y+l/2,e=z+h;
    this.face([[a,c,e],[b,c,e],[b,d,e],[a,d,e]],color);
    this.face([[a,d,z],[b,d,z],[b,c,z],[a,c,z]],color);
    this.face([[b,c,z],[b,d,z],[b,d,e],[b,c,e]],color);
    this.face([[a,d,z],[a,c,z],[a,c,e],[a,d,e]],color);
    this.face([[b,d,z],[a,d,z],[a,d,e],[b,d,e]],color);
    this.face([[a,c,z],[b,c,z],[b,c,e],[a,c,e]],color);
  }
  // Swept octagonal sections, clockwise viewed along +Y, bevelled shoulders.
  shell(stations: [number,number,number,number,number][], color:V=PAINT) {
    const rings = stations.map(([y,w,base,top,bevel]) => [
      [-w/2+bevel,y,base],[w/2-bevel,y,base],[w/2,y,base+bevel],
      [w/2,y,top-bevel],[w/2-bevel,y,top],[-w/2+bevel,y,top],
      [-w/2,y,top-bevel],[-w/2,y,base+bevel]
    ] as V[]);
    this.face(rings[0],color);
    this.face([...rings[rings.length-1]].reverse(),color);
    for(let k=0;k<rings.length-1;k++) for(let i=0;i<8;i++) {
      const j=(i+1)%8;
      this.face([rings[k+1][i],rings[k+1][j],rings[k][j],rings[k][i]],color);
    }
  }
  wheel(x:number,y:number,r:number,width:number,segments=12) {
    const ring=(xx:number,rr:number):V[]=>Array.from({length:segments},(_,i)=>[xx,y+Math.cos(i*2*Math.PI/segments)*rr,r+Math.sin(i*2*Math.PI/segments)*rr]);
    const a=ring(x-width/2,r), b=ring(x+width/2,r);
    for(let i=0;i<segments;i++){const j=(i+1)%segments;this.face([b[i],b[j],a[j],a[i]],RUBBER);}
    this.face([...a].reverse(),RUBBER);this.face(b,RUBBER);
    for(const sign of [-1,1]) {
      const rr=ring(x+sign*(width/2+0.002),r*.61);
      this.face(sign===1?rr:[...rr].reverse(),METAL);
      const hub=ring(x+sign*(width/2+0.004),r*.23);
      this.face(sign===1?hub:[...hub].reverse(),DARK);
    }
  }
  lettering(text:string, origin:V, size:number, side:number, color:V) {
    const glyphs:Record<string,string[]>={
      S:["1111","1000","1000","1111","0001","0001","1111"],
      B:["1110","1001","1001","1110","1001","1001","1110"],
      T:["11111","00100","00100","00100","00100","00100","00100"],
      R:["1110","1001","1001","1110","1010","1001","1001"],
      A:["0110","1001","1001","1111","1001","1001","1001"],
      N:["1001","1101","1101","1011","1011","1001","1001"],
      I:["111","010","010","010","010","010","111"],
      "1":["010","110","010","010","010","010","111"],
      "4":["1001","1001","1001","1111","0001","0001","0001"],
      "3":["1110","0001","0001","0110","0001","0001","1110"]
    };
    let cursor=0;
    const point=(u:number,v:number):V=>side===0 ? [origin[0]+u*size,origin[1],origin[2]-v*size] : [origin[0],origin[1]-side*u*size,origin[2]-v*size];
    for(const ch of text){const g=glyphs[ch];if(!g){cursor+=3;continue;}
      for(let row=0;row<7;row++)for(let col=0;col<g[row].length;col++)if(g[row][col]==="1"){
        const start=col;while(col+1<g[row].length&&g[row][col+1]==="1")col++;
        this.face([point(cursor+start,row),point(cursor+col+1,row),point(cursor+col+1,row+1),point(cursor+start,row+1)],color);
      }
      cursor+=g[0].length+1;
    }
  }
  geometry() {return new Geometry({topology:"triangle-list", attributes:{
    positions:{size:3,value:new Float32Array(this.p)}, normals:{size:3,value:new Float32Array(this.n)},
    colors:{size:3,value:new Float32Array(this.c)}, texCoords:{size:2,value:new Float32Array(this.uv)}
  }});}
}
function buildGeometry(boxes:Box[]):Geometry {const m=new Mesh();for(const b of boxes)m.box(...b);return m.geometry();}

// Corolla Altis E210-inspired sedan: rounded body, actual open wheel arches,
// separate painted pillars, inset glazing, swept lamps and a five-spoke rim.
function car():Geometry {
  const m=new Mesh();
  const silver:V=[.76,.79,.82], chrome:V=[.72,.76,.80];
  const profile:[number,number,number][]=[[-2.315,.73,.70],[-2.12,.84,.79],[-1.70,.89,.86],[-1.25,.89,.87],[0,.89,.85],[1.35,.88,.83],[1.86,.84,.76],[2.18,.78,.65],[2.315,.70,.57]];
  const interp=(y:number,k:number)=>{for(let i=1;i<profile.length;i++)if(y<=profile[i][0]){const t=(y-profile[i-1][0])/(profile[i][0]-profile[i-1][0]);return profile[i-1][k]*(1-t)+profile[i][k]*t;}return profile[profile.length-1][k];};
  const ys=[-2.315,-2.23,-2.12,-1.9,-1.72,-1.65,-1.58,-1.50,-1.42,-1.35,-1.28,-1.20,-1.12,-1.05,-.98,-.85,-.55,0,.55,.85,.98,1.05,1.12,1.20,1.28,1.35,1.42,1.50,1.58,1.65,1.72,1.9,2.12,2.23,2.315];
  const rings=ys.map(y=>{
    const w=interp(y,1),h=interp(y,2),dy=Math.min(Math.abs(y-1.35),Math.abs(y+1.35));
    const low=dy<.37?.316+Math.sqrt(.37*.37-dy*dy):.23;
    return [[-w*.88,y,low],[w*.88,y,low],[w,y,Math.max(low,h*.58)],[w,y,h-.10],[w*.94,y,h-.025],[w*.70,y,h+.016],[0,y,h+.035],[-w*.70,y,h+.016],[-w*.94,y,h-.025],[-w,y,h-.10],[-w,y,Math.max(low,h*.58)]] as V[];
  });
  m.face(rings[0],silver);m.face([...rings[rings.length-1]].reverse(),silver);
  for(let k=0;k<rings.length-1;k++)for(let i=0;i<rings[k].length;i++){const j=(i+1)%rings[k].length;m.face([rings[k+1][i],rings[k+1][j],rings[k][j],rings[k][i]],silver);}
  // Cabin roof is a curved dome, with a gently bowed windscreen and rear screen.
  const cab:[number,number,number][]=[[-1.45,.77,.89],[-1.23,.74,1.10],[-.88,.68,1.37],[-.65,.66,1.425],[.26,.66,1.435],[.49,.68,1.38],[.85,.73,1.10],[1.10,.78,.88]];
  const cr=cab.map(([y,w,h])=>[[-w,y,.85],[w,y,.85],[w*.99,y,h-.13],[w*.91,y,h-.045],[w*.65,y,h-.008],[0,y,h],[-w*.65,y,h-.008],[-w*.91,y,h-.045],[-w*.99,y,h-.13]] as V[]);
  m.face(cr[0],silver);m.face([...cr[cr.length-1]].reverse(),silver);
  for(let k=0;k<cr.length-1;k++)for(let i=0;i<9;i++){const j=(i+1)%9;m.face([cr[k+1][i],cr[k+1][j],cr[k][j],cr[k][i]],silver);}
  // Glass panels follow the roof surface instead of using a second solid cabin.
  for(const [start,end] of [[0,2],[5,7]])for(let k=start;k<end;k++)for(let i=2;i<6;i++){
    const out=(v:V):V=>[v[0],v[1]+(start===0?-.009:.009),v[2]+.009];
    m.face([out(cr[k+1][i]),out(cr[k+1][i+1]),out(cr[k][i+1]),out(cr[k][i])],GLASS);
  }
  for(const sign of [-1,1]) {
    const panel=(points:V[],color:V)=>m.face(sign===1?points:[...points].reverse(),color);
    const v=(x:number,y:number,z:number):V=>[sign*x,y,z];
    // Distinct front and rear door glass, black B pillar, silver A/C pillars.
    panel([v(.766,-1.17,.91),v(.783,-.22,.91),v(.674,-.22,1.342),v(.685,-.80,1.285)],GLASS);
    panel([v(.783,-.14,.91),v(.768,.89,.91),v(.687,.43,1.285),v(.674,-.14,1.342)],GLASS);
    panel([v(.787,-.22,.90),v(.787,-.14,.90),v(.679,-.14,1.353),v(.679,-.22,1.353)],DARK);
    // Subtle lower door shut-lines and chrome handles.
    for(const y of [-.23,-1.04,.90])m.box(sign*.892,y,.38,.006,.012,.36,[.39,.42,.45]);
    for(const y of [-.72,.43])m.box(sign*.891,y,.79,.018,.16,.025,chrome);
    m.box(sign*.92,.75,.91,.16,.26,.10,silver);
    m.box(sign*.955,.734,.925,.11,.17,.045,GLASS);
    for(const y of [-1.35,1.35]) {
      m.wheel(sign*.785,y,.316,.205,20);
      // Five open-looking spoke blades on the outer rim.
      for(let i=0;i<5;i++){
        const angle=i*Math.PI*2/5;
        const pt=(r:number,a:number):V=>[sign*.892,y+Math.cos(a)*r,.316+Math.sin(a)*r];
        panel([pt(.045,angle-.30),pt(.176,angle-.13),pt(.176,angle+.13),pt(.045,angle+.30)],chrome);
      }
    }
    // Narrow swept headlamp lenses wrap over the front corners.
    panel([v(.55,2.14,.72),v(.82,2.14,.72),v(.70,2.323,.61),v(.34,2.323,.60)],LIGHT);
    panel([v(.30,-2.323,.67),v(.72,-2.323,.64),v(.83,-2.13,.76),v(.48,-2.13,.77)],[.65,.018,.025]);
  }
  // Trapezoidal lower grille, upper chrome wing and Singapore-style black plates.
  m.face([[-.62,2.328,.31],[.62,2.328,.31],[.48,2.328,.51],[-.48,2.328,.51]].reverse() as V[],RUBBER);
  m.box(0,2.334,.56,1.12,.008,.018,chrome);
  for(let i=0;i<4;i++)m.box(0,2.338,.34+i*.041,1.02-i*.09,.008,.011,DARK);
  m.box(0,2.350,.46,.39,.012,.09,RUBBER);
  m.box(0,-2.333,.47,.39,.012,.09,RUBBER);
  m.box(0,-2.329,.29,1.23,.013,.045,DARK);
  return m.geometry();
}
// Singapore single-deck, two-door, left boarding; Scania K230UB-inspired silhouette.
function bus():Geometry {
  const m=new Mesh();
  const purple:V=[.43,.035,.29], red:V=[.90,.13,.065];
  m.shell([[-6,2.39,.32,2.96,.12],[-5.65,2.55,.28,3.05,.13],[5.60,2.55,.28,3.05,.13],[6,2.42,.35,2.98,.17]]);
  // SBS Transit purple skirt and red roof cap from the supplied K230UB references.
  m.shell([[-6.012,2.394,.32,.88,.09],[-5.65,2.56,.28,.88,.09],[5.60,2.56,.28,.88,.09],[6.012,2.424,.35,.88,.09]],purple);
  m.shell([[-6,2.39,2.90,2.96,.02],[-5.65,2.55,2.90,3.055,.05],[5.60,2.55,2.90,3.055,.05],[6,2.42,2.90,2.98,.02]],red);
  m.box(0,0,.33,2.58,11.45,.12,DARK);
  for(const s of [-1,1]) {
    for(const y of [-3.75,2.95])m.wheel(s*1.17,y,.49,.22,16);
    // A continuous dark glazing belt with narrow structural mullions.
    m.box(s*1.277,-.10,1.28,.018,10.85,1.38,GLASS);
    for(const y of [-5.25,-3.8,-2.35,-.9,.55,2,3.45,4.9])m.box(s*1.291,y,1.28,.018,.055,1.39,DARK);
    m.box(s*1.31,5.47,2.12,.15,.25,.52,DARK);
    m.box(s*1.30,5.45,2.58,.10,.72,.055,DARK);
    m.box(s*1.285,-4.9,.61,.025,.92,.48,DARK);
    for(let i=0;i<6;i++)m.box(s*1.304,-4.9,.65+i*.065,.012,.83,.018,METAL);
  }
  for(const y of [4.65,-.55]) {
    m.box(-1.302,y,.38,.024,1.19,2.28,DARK);
    for(const offset of [-.30,.30])m.box(-1.320,y+offset,.54,.012,.52,1.93,GLASS);
    m.box(-1.33,y,.44,.014,.035,2.12,METAL);
  }
  m.box(0,6.018,1.09,2.12,.025,1.47,GLASS);
  m.box(0,6.020,2.60,2.03,.024,.29,DARK);
  m.lettering("143",[.57,6.041,2.85],.028,0,[1,.55,.08]);
  for(const sign of [-1,1])m.lettering("SBS TRANSIT",[sign*1.295,sign*2.9,1.16],.028,sign,[.63,.06,.31]);
  m.box(0,-6.009,1.40,2.03,.02,1.10,GLASS);
  for(const s of [-1,1]) {
    m.box(s*.91,6.021,.62,.37,.025,.13,LIGHT);
    m.box(s*1.03,-6.01,.55,.13,.025,.38,[.7,.07,.05]);
  }
  m.box(0,6.012,.43,.43,.014,.12,LIGHT);
  m.box(0,-6.025,.46,.43,.014,.12,LIGHT);
  m.shell([[-3.5,1.64,3.05,3.20,.05],[.10,1.64,3.05,3.20,.05]],red);
  for(let i=0;i<8;i++)m.box(0,-2.95+i*.34,3.202,1.20,.10,.008,DARK);
  return m.geometry();
}
// One C151-style driving carriage; repeated by the existing track animation.
// End-car envelope approximately 23.8 x 3.2 x 3.7 m; not a complete six-car set.
function mrt():Geometry {
  const m=new Mesh();
  const silver:V=[.66,.69,.72], stripe:V=[.79,.035,.045];
  m.shell([[-11.90,2.94,.82,3.53,.24],[-11.35,3.20,.72,3.70,.26],[10.75,3.20,.72,3.70,.26],[11.90,2.85,.87,3.46,.24]],silver);
  for(const y of [-7.75,7.75]) {
    m.box(0,y,.28,2.40,2.9,.58,DARK);
    for(const yy of [y-.90,y+.90])for(const s of [-1,1])m.wheel(s*1.10,yy,.36,.16,12);
  }
  m.box(0,0,.38,2.2,9.4,.35,DARK);
  for(const s of [-1,1]) {
    m.box(s*1.605,-.15,1.13,.015,21.5,.27,stripe);
    for(const y of [-8.25,-2.75,2.75,8.25]) {
      m.box(s*1.613,y,1.41,.014,1.44,1.83,METAL);
      for(const off of [-.37,.37])m.box(s*1.625,y+off,2.14,.012,.57,.84,GLASS);
      m.box(s*1.637,y,1.43,.012,.025,1.79,DARK);
    }
    for(const y of [-10.30,-5.50,0,5.50,10.0])m.box(s*1.615,y,2.01,.018,2.18,1.05,GLASS);
  }
  m.face([[-1.14,11.939,3.19],[1.14,11.939,3.19],[1.17,11.939,1.95],[-1.17,11.939,1.95]],GLASS);
  m.box(0,11.91,1.23,2.56,.028,.29,stripe);
  for(const s of [-1,1])m.box(s*.98,11.939,1.56,.35,.022,.14,LIGHT);
  m.box(0,12.04,.51,.45,.42,.28,DARK);
  m.box(0,-12.01,1.13,1.02,.22,1.94,DARK);
  for(let i=0;i<7;i++)m.box(0,-12.14,1.18+i*.25,1.03,.04,.045,METAL);
  for(const y of [-5.1,5.1]) {
    m.shell([[y-1.6,2.06,3.61,3.87,.08],[y+1.6,2.06,3.61,3.87,.08]],METAL);
    for(let i=0;i<7;i++)m.box(0,y-1.15+i*.38,3.873,1.56,.12,.01,DARK);
  }
  return m.geometry();
}

const CYCLE: Box[] = [
  // wheels (thin verticals)
  [0, 0.55, 0, 0.12, 0.75, 0.75], [0, -0.55, 0, 0.12, 0.75, 0.75],
  // frame
  [0, 0, 0.4, 0.14, 1.15, 0.3],
  // handlebar
  [0, 0.5, 0.95, 0.55, 0.1, 0.12],
  // rider torso + head
  [0, -0.15, 0.75, 0.42, 0.5, 0.75],
  [0, -0.1, 1.55, 0.3, 0.3, 0.3],
];

const WALK: Box[] = [
  // legs
  [-0.11, 0, 0, 0.16, 0.22, 0.5], [0.11, 0, 0, 0.16, 0.22, 0.5],
  // torso
  [0, 0, 0.5, 0.5, 0.28, 0.65],
  // arms
  [-0.31, 0, 0.55, 0.12, 0.2, 0.55], [0.31, 0, 0.55, 0.12, 0.2, 0.55],
  // head
  [0, 0, 1.2, 0.3, 0.3, 0.32],
];

export type VehicleKind = "car" | "bus" | "mrt" | "walk" | "cycle";

/** Build all vehicle geometries. Call once (memoised) on the client. */
export function buildVehicleMeshes(): Record<VehicleKind, Geometry> {
  return {
    car: car(),
    bus: bus(),
    mrt: mrt(),
    walk: buildGeometry(WALK),
    cycle: buildGeometry(CYCLE),
  };
}

/** A 1 × 1 × 1 m block with its base at z = 0 (Y = long axis). Scaled per building for the island skyline. */
export function buildUnitBlock(): Geometry {
  return buildGeometry([[0, 0, 0, 1, 1, 1]]);
}
