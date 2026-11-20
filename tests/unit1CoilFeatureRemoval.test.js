const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
test('removed coil management endpoints cannot be registered while production lookups and historical details remain',()=>{
 const file=path.join(__dirname,'../routes/unit1CoilRoutes.js'),localRequire=createRequire(file),registered=[];
 const router={use(){}};for(const method of ['get','post','put','delete'])router[method]=(route)=>registered.push(method.toUpperCase()+' '+route);
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:{exports:{}},require:name=>name==='express'?{Router:()=>router}:name==='../config/unit1Db'?{}:name==='../middleware/unit1AuthMiddleware'||name==='../middleware/roleMiddleware'?()=>()=>{}:localRequire(name)});
 assert.deepEqual(registered,['GET /stock-sizes','POST /stock-sizes','POST /:id/print-qr','GET /stock-invoices','GET /stock-summary','POST /stock-receipts','GET /scan/:internalId/:coilNumber','GET /lookup/:internalId','GET /:id/physical/:number','GET /:id/usage','GET /:id']);
});
