const router=require('express').Router(),db=require('../config/unit1Db'),access=require('../middleware/roleMiddleware');
const {parseQr,roleFields,scanMaterial,coilDetails}=require('../services/unit1QrScanner');
router.use(require('../middleware/unit1AuthMiddleware'));
router.post('/',async(req,res,next)=>{
  try{
    const target=parseQr(req.body?.payload);
    await access([],target.type==='coil'?'unit1.coils.scan':'unit1.material-stock.view')(req,res,async()=>{
      try{
        if(target.type==='material'){const selected=await roleFields(db,req.user.role);return res.json({data:await scanMaterial(db,target,selected)});}
        const scanReq={params:{internalId:target.reference,...(target.number?{coilNumber:String(target.number)}:{})},user:req.user};
        const output={status(code){res.status(code);return this;},json(body){return res.json(body.data?{data:coilDetails(body.data)}:body);}};
        await require('./unit1CoilRoutes').scanCoil(scanReq,output,next);
      }catch(error){next(error);}
    });
  }catch(error){next(error);}
});
module.exports=router;
