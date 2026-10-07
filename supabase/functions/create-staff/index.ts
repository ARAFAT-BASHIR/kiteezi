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
  const {data:callerProfile,error:callerProfileError}=await admin.from("profiles").select("role,active,organization_id").eq("id",user.id).maybeSingle();
  if(callerProfileError||!callerProfile) return json({error:"Caller profile could not be loaded"},403);
  if(callerProfile.role!=="owner"||callerProfile.active!==true) return json({error:"Owner only"},403);
  if(!callerProfile.organization_id) return json({error:"Owner organization is not configured"},500);
  const b=await req.json();
  const name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
  const role=String(b.role||"").trim(),phone=String(b.phone||"").trim();
  const avatar_url=String(b.avatar_url||"").trim()||null,background_info=String(b.background_info||"").trim()||null;
  const position_id=String(b.position_id||"").trim()||null,employment_type=String(b.employment_type||"").trim()||null;
  const pay_frequency=String(b.pay_frequency||"").trim()||null,supervisor_profile_id=String(b.supervisor_profile_id||"").trim()||null;
  if(!name||!email||password.length<8||!role)return json({error:"Name, email, password (8+ characters) and role are required"},400);
  const {data:roleRow,error:roleError}=await admin.from("roles").select("name").eq("name",role).maybeSingle();
  if(roleError||!roleRow)return json({error:"Invalid role"},400);
  if(position_id){const {data:positionRow,error:positionError}=await admin.from("team_positions").select("id,active").eq("id",position_id).maybeSingle();if(positionError||!positionRow||positionRow.active!==true)return json({error:"Invalid or inactive position"},400);}
  if(employment_type&&!["salary","wage","contract","casual"].includes(employment_type))return json({error:"Invalid employment type"},400);
  if(pay_frequency&&!["monthly","daily","hourly","per_shift"].includes(pay_frequency))return json({error:"Invalid pay frequency"},400);
  if(supervisor_profile_id){const {data:supervisor,error:supervisorError}=await admin.from("profiles").select("id,active,organization_id").eq("id",supervisor_profile_id).maybeSingle();if(supervisorError||!supervisor||supervisor.active!==true||supervisor.organization_id!==callerProfile.organization_id)return json({error:"Invalid or inactive supervisor"},400);}
  if(role==="owner"){const {count}=await admin.from("profiles").select("id",{count:"exact",head:true}).eq("role","owner").eq("organization_id",callerProfile.organization_id);if((count||0)>=2)return json({error:"Only two owner accounts are allowed"},400);}
  const {data:i,error:ie}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name}});
  if(ie||!i.user)return json({error:ie?.message||"Account creation failed"},400);
  const {error:pe}=await admin.from("profiles").insert({id:i.user.id,full_name:name,phone:phone||null,role,active:true,avatar_url,background_info,organization_id:callerProfile.organization_id,position_id,employment_type,pay_frequency,supervisor_profile_id});
  if(pe){await admin.auth.admin.deleteUser(i.user.id);return json({error:"Could not create staff profile: "+pe.message},500);}
  return json({ok:true,id:i.user.id,email,role});
});