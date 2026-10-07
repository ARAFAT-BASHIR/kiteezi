import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, prefer","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);

  const url=Deno.env.get("SUPABASE_URL")!;
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const auth=req.headers.get("Authorization")||"";
  const admin=createClient(url,service);
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await caller.auth.getUser();
  if(!user) return json({error:"Unauthorized"},401);

  const {data:callerProfile,error:callerError}=await admin.from("profiles").select("role,active,organization_id").eq("id",user.id).maybeSingle();
  if(callerError||!callerProfile||callerProfile.role!=="owner"||callerProfile.active!==true) return json({error:"Only an active owner can manage staff account security."},403);

  const body=await req.json();
  const targetId=String(body.id||"").trim();
  if(!targetId) return json({error:"Staff member was not specified."},400);

  const {data:target,error:targetError}=await admin.from("profiles").select("id,full_name,role,active,organization_id").eq("id",targetId).maybeSingle();
  if(targetError||!target) return json({error:"Staff member could not be found."},404);
  if(target.organization_id!==callerProfile.organization_id) return json({error:"That staff member belongs to another organization."},403);

  if(body.send_recovery===true){
    const {data:authUser,error:authError}=await admin.auth.admin.getUserById(targetId);
    if(authError||!authUser?.user?.email) return json({error:"The staff account email could not be found."},400);
    const {error:recoveryError}=await caller.auth.resetPasswordForEmail(authUser.user.email,{redirectTo:new URL("/admin/?password_reset=1",req.url).toString()});
    if(recoveryError) return json({error:"Password recovery email could not be sent."},500);
    return json({ok:true,message:"Password recovery email sent."});
  }

  const updates:Record<string,string>={};
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  if(email) updates.email=email;
  if(password){
    if(password.length<8) return json({error:"Password must be at least 8 characters."},400);
    updates.password=password;
  }
  if(!Object.keys(updates).length) return json({error:"Enter an email or new password."},400);

  const {error:updateError}=await admin.auth.admin.updateUserById(targetId,updates);
  if(updateError) return json({error:updateError.message||"Staff account security could not be updated."},400);

  return json({ok:true,message:"Staff account security updated."});
});