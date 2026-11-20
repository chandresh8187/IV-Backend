const PUNCH_NAMES=['A','B','C','D','E'];
const sizeKey=value=>String(value||'').trim().replace(/\s+/g,'').replace(/[×*X]/g,'x');
const normalizePunchName=value=>String(value??'').trim().toUpperCase().replace(/^PUNCH\s+/,'');
function punchNameFor(hole,holes=[],fallbackSize=''){
 if(hole.punchName!=null){const name=normalizePunchName(hole.punchName);return PUNCH_NAMES.includes(name)?name:'';}
 if(PUNCH_NAMES.includes(hole.punchLetter))return hole.punchLetter;
 const sizes=[...new Set(holes.map(h=>sizeKey(h.punchSize||fallbackSize)))];
 return PUNCH_NAMES[sizes.indexOf(sizeKey(hole.punchSize||fallbackSize))]||'';
}
function withPunchNames(holes,{legacy=false}={}){
 const sizes=new Map();return holes.map(hole=>{
  if(Object.hasOwn(hole,'punchName')&&hole.punchName===null)return {...hole,punchName:null};
  const name=punchNameFor(hole,holes);
  if(!name&&!legacy)throw Object.assign(new Error('Select a punch name from PUNCH A to PUNCH E.'),{status:400});
  const size=sizeKey(hole.punchSize);
  if(name&&sizes.has(name)&&sizes.get(name)!==size&&!legacy)throw Object.assign(new Error(`PUNCH ${name} must use the same size on every profile.`),{status:400});
  if(name)sizes.set(name,size);
  return {...hole,punchName:name||null};
 });
}
module.exports={PUNCH_NAMES,normalizePunchName,punchNameFor,withPunchNames};
