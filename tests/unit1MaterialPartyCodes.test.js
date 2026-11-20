const test=require('node:test'),assert=require('node:assert/strict');
const {generatePartyCode,ensurePartyCode,resolvePartyCode}=require('../services/unit1MaterialPartyCodes');
test('party IDs are ten uppercase characters containing letters and numbers, without ambiguous glyphs',()=>{
 for(let n=0;n<100;n++){const code=generatePartyCode();assert.match(code,/^[A-HJ-NP-Z2-9]{10}$/);assert.match(code,/[A-Z]/);assert.match(code,/[2-9]/);}
});
test('stored party IDs survive retries and code collisions cannot assign the same ID to another party',async()=>{
 const rows=new Map();let attempts=0;
 const db={execute:async(sql,args)=>{
  if(sql.startsWith('SELECT party_code'))return [[rows.has(args[0])?{partyCode:rows.get(args[0])}:undefined].filter(Boolean)];
  if(sql.startsWith('SELECT party_key')){const entry=[...rows].find(([,v])=>v===args[0]);return [[entry?{partyKey:entry[0]}:undefined].filter(Boolean)];}
  attempts++;if(rows.has(args[0])||[...rows.values()].includes(args[1]))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});rows.set(args[0],args[1]);return [{affectedRows:1}];
 }};
 const a='a'.repeat(64),b='b'.repeat(64);
 assert.equal(await ensurePartyCode(db,a,{generate:()=> 'AB23CD45EF'}),'AB23CD45EF');
 assert.equal(await ensurePartyCode(db,a,{generate:()=>{throw Error('must not regenerate')}}),'AB23CD45EF');
 const codes=['AB23CD45EF','GH67JK89LM'];assert.equal(await ensurePartyCode(db,b,{generate:()=>codes.shift()}),'GH67JK89LM');assert.equal(attempts,3);
 assert.equal(await resolvePartyCode(db,'  ab23cd45ef  '),a);
 await assert.rejects(resolvePartyCode(db,'ZZ23ZZ45ZZ'),{status:404});await assert.rejects(resolvePartyCode(db,'1234567890'),{status:400});
});
