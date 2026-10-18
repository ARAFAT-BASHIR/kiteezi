REVOKE SELECT ON TABLE
  public.inventory_physical_position,
  public.v_action_report,
  public.v_ap_aging,
  public.v_ar_aging,
  public.v_asset_register,
  public.v_balance_sheet,
  public.v_cash_flow,
  public.v_cash_report,
  public.v_department_performance,
  public.v_general_ledger,
  public.v_income_statement,
  public.v_operational_action_report,
  public.v_payroll_summary,
  public.v_performance_report,
  public.v_trial_balance
FROM anon, PUBLIC;

ALTER VIEW public.inventory_physical_position SET (security_invoker = true);
ALTER VIEW public.inventory_stock SET (security_invoker = true);
ALTER VIEW public.v_action_report SET (security_invoker = true);
ALTER VIEW public.v_ap_aging SET (security_invoker = true);
ALTER VIEW public.v_ar_aging SET (security_invoker = true);
ALTER VIEW public.v_asset_register SET (security_invoker = true);
ALTER VIEW public.v_balance_sheet SET (security_invoker = true);
ALTER VIEW public.v_cash_flow SET (security_invoker = true);
ALTER VIEW public.v_cash_report SET (security_invoker = true);
ALTER VIEW public.v_department_performance SET (security_invoker = true);
ALTER VIEW public.v_general_ledger SET (security_invoker = true);
ALTER VIEW public.v_income_statement SET (security_invoker = true);
ALTER VIEW public.v_operational_action_report SET (security_invoker = true);
ALTER VIEW public.v_payroll_summary SET (security_invoker = true);
ALTER VIEW public.v_performance_report SET (security_invoker = true);
ALTER VIEW public.v_trial_balance SET (security_invoker = true);
