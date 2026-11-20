const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
function request(port, path, {method='GET',body='',headers={}}={}) {
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,headers:{...headers,'Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Smoke request timeout')));req.end(body);});
}
test('patched HTTP dependencies preserve JSON, forms, APK filtering, security headers, rate limits and Socket.IO handshake',async()=>{
 const app=express();app.use(helmet());app.use(cors());app.use(express.json());app.use(express.urlencoded({extended:true}));
 app.post('/echo',(req,res)=>res.json(req.body));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:32},fileFilter:(_req,file,cb)=>cb(null,file.originalname.toLowerCase().endsWith('.apk'))});
 app.post('/upload',upload.single('apk'),(req,res)=>res.json({accepted:!!req.file,size:req.file?.size}));
 app.get('/limited',rateLimit({windowMs:60000,limit:1,standardHeaders:'draft-8',legacyHeaders:false}),(_req,res)=>res.send('ok'));
 app.use((error,_req,res,_next)=>res.status(error instanceof multer.MulterError?413:400).json({error:error.code||'INVALID_JSON'}));
 const server=http.createServer(app),io=new Server(server);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  let res=await request(port,'/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({party:'Test',quantity:64})});assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.text),{party:'Test',quantity:64});assert.equal(res.headers['x-content-type-options'],'nosniff');assert.equal(res.headers['access-control-allow-origin'],'*');
  res=await request(port,'/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'});assert.equal(res.status,400);
  res=await request(port,'/echo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'party[name]=Test&quantity=64'});assert.deepEqual(JSON.parse(res.text),{party:{name:'Test'},quantity:'64'});
  const multipart=(filename,data)=>({method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=smoke-boundary'},body:`--smoke-boundary\r\nContent-Disposition: form-data; name="apk"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${data}\r\n--smoke-boundary--\r\n`});
  res=await request(port,'/upload',multipart('update.apk','APK'));assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.text),{accepted:true,size:3});
  res=await request(port,'/upload',multipart('file.txt','no'));assert.equal(JSON.parse(res.text).accepted,false);
  res=await request(port,'/upload',multipart('large.apk','X'.repeat(33)));assert.equal(res.status,413);
  assert.equal((await request(port,'/limited')).status,200);assert.equal((await request(port,'/limited')).status,429);
  res=await request(port,'/socket.io/?EIO=4&transport=polling');assert.equal(res.status,200);assert.match(res.text,/^0\{/);
 }finally{await new Promise(resolve=>io.close(resolve));}
});
test('Firebase Admin subpath imports and MySQL pool API remain available without contacting services',async()=>{
 assert.equal(typeof require('firebase-admin/app').initializeApp,'function');
 assert.equal(typeof require('firebase-admin/messaging').getMessaging,'function');
 const pool=require('mysql2/promise').createPool({host:'127.0.0.1',connectionLimit:1});assert.equal(typeof pool.getConnection,'function');await pool.end();
});
