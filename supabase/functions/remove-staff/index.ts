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
  const body=await req.json().catch(()=>({}));
  const targetId=String(body.id||"").trim();
  const action=String(body.action||"disable").trim().toLowerCase();
  if(!targetId) return json({error:"Staff member was not specified."},400);
  if(targetId===user.id) return json({error:"You cannot change your own account here."},400);
  const {data:target,error:targetError}=await admin.from("profiles").select("id,full_name,role,active,organization_id").eq("id",targetId).maybeSingle();
  if(targetError||!target) return json({error:"Staff member could not be found."},404);
  if(target.organization_id!==callerProfile.organization_id) return json({error:"That staff member belongs to another organization."},403);
  if(target.role==="owner") return json({error:"Owner accounts cannot be managed here."},400);

  if(action==="restore"){
    const {error:unbanError}=await admin.auth.admin.updateUserById(targetId,{ban_duration:"none"});
    if(unbanError) return json({error:"The login could not be re-enabled."},500);
    const {error:profileError}=await admin.from("profiles").update({active:true}).eq("id",targetId);
    if(profileError){
      await admin.auth.admin.updateUserById(targetId,{ban_duration:"876000h"}).catch(()=>{});
      return json({error:"The staff profile could not be re-enabled."},500);
    }
    return json({ok:true,id:targetId,name:target.full_name,active:true,login_enabled:true});
  }

  if(action==="disable"){
    const {error:profileError}=await admin.from("profiles").update({active:false,position_id:null,supervisor_profile_id:null}).eq("id",targetId);
    if(profileError) return json({error:"The staff profile could not be disabled."},500);
    const {error:banError}=await admin.auth.admin.updateUserById(targetId,{ban_duration:"876000h"});
    if(banError) return json({error:"The profile was disabled, but its login could not be disabled. Please try again."},500);
    return json({ok:true,id:targetId,name:target.full_name,active:false,login_enabled:false});
  }

  if(action==="delete"){
    // Permanent deletion is allowed only when no protected non-null historical
    // references exist. Nullable audit/operational links are detached first so
    // the business history itself remains intact.
    const protectedChecks=[
      ["approval_audit_trail","approver_id"],["payroll_lines","employee_id"],
      ["requisition_versions","created_by"],["requisitions","created_by"],
      ["requisitions","requester_id"],["service_logs","staff_id"]
    ] as const;
    const references:{table:string;column:string;count:number}[]=[];
    for(const [table,column] of protectedChecks){
      const {count,error}=await admin.from(table).select("*",{count:"exact",head:true}).eq(column,targetId);
      if(error) return json({error:"The account could not be checked for protected history."},500);
      if((count||0)>0) references.push({table,column,count:count||0});
    }
    if(references.length){
      return json({error:"This staff account has protected operational or payroll history, so it cannot be permanently deleted. Keep it as an inactive former staff record instead.",code:"STAFF_HAS_HISTORY",references:references.map(x=>x.table+"."+x.column+" ("+x.count+")")},409);
    }

    // Detach nullable historical references and remove device subscriptions.
    const nullableRefs=[
      ["audit_logs","actor_id"],["bookings","created_by"],["credit_notes","created_by"],
      ["expenses","created_by"],["gallery_items","approved_by"],["invoices","created_by"],
      ["journal_entries","created_by"],["operational_events","actor_id"],["orders","created_by"],
      ["payroll_runs","created_by"],["purchase_orders","paid_by"],["purchase_orders","received_by"],
      ["receipts","created_by"],["requisitions","deleted_by"],["staff_tasks","assigned_to"],
      ["stock_movements","staff_id"],["swimming_sessions","coach_id"],["team_positions","staff_profile_id"]
    ] as const;
    for(const [table,column] of nullableRefs){
      const {error}=await admin.from(table).update({[column]:null}).eq(column,targetId);
      if(error) return json({error:"The account could not be safely detached from its historical records."},500);
    }
    const {error:subscriptionError}=await admin.from("push_subscriptions").delete().eq("user_id",targetId);
    if(subscriptionError) return json({error:"The account's device notifications could not be removed."},500);

    const {error:deleteError}=await admin.auth.admin.deleteUser(targetId,false);
    if(deleteError) return json({error:"The staff account could not be permanently deleted."},500);
    return json({ok:true,id:targetId,deleted:true});
  }

  return json({error:"Unsupported staff access action."},400);

});