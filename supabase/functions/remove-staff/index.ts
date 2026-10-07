import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, prefer","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,auth=req.headers.get("Authorization")||"";
  const admin=createClient(url,service);
  const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await caller.auth.getUser();
  if(!user) return json({error:"Unauthorized"},401);
  const {data:callerProfile,error:callerError}=await admin.from("profiles").select("role,active,organization_id").eq("id",user.id).maybeSingle();
  if(callerError||!callerProfile||callerProfile.active!==true||callerProfile.role!=="owner") return json({error:"Only an active owner can remove staff accounts."},403);
  const body=await req.json(),targetId=String(body.id||"").trim();
  if(!targetId) return json({error:"Staff member was not specified."},400);
  if(targetId===user.id) return json({error:"You cannot remove your own account."},400);
  const {data:target,error:targetError}=await admin.from("profiles").select("id,full_name,role,active,organization_id").eq("id",targetId).maybeSingle();
  if(targetError||!target) return json({error:"Staff member could not be found."},404);
  if(target.organization_id!==callerProfile.organization_id) return json({error:"That staff member belongs to another organization."},403);
  if(target.role==="owner") return json({error:"Owner accounts cannot be removed here."},400);
  const {error:profileError}=await admin.from("profiles").update({active:false,position_id:null,supervisor_profile_id:null}).eq("id",targetId);
  if(profileError) return json({error:"The staff profile could not be removed."},500);
  const {error:authError}=await admin.auth.admin.deleteUser(targetId);
  if(authError){
    console.error("Staff auth deletion failed:",authError);
    const {error:banError}=await admin.auth.admin.updateUserById(targetId,{ban_duration:"876000h"});
    if(banError){
      console.error("Staff login disable fallback failed:",banError);
      return json({error:"The staff profile was disabled, but its login could not be disabled. Please try again."},500);
    }
    return json({ok:true,id:targetId,name:target.full_name,login_disabled:true});
  }
  return json({ok:true,id:targetId,name:target.full_name,login_disabled:true});
});