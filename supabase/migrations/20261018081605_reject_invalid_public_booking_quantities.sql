DO $migration$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.submit_public_booking_v3(text,text,text,date,time,integer,text,jsonb)'::regprocedure
  ) INTO v_def;

  v_old := 'v_qty:=greatest(1,coalesce((c->>''quantity'')::integer,p_people));';
  v_new := 'v_qty:=coalesce((c->>''quantity'')::integer,p_people); if v_qty<1 then raise exception ''Component quantity must be at least 1''; end if;';
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected quantity validation code was not found; no booking function changed';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  SELECT pg_get_functiondef(
    'public.submit_school_swimming_booking(text,text,text,integer,time,integer,text)'::regprocedure
  ) INTO v_def;

  v_old := 'begin' || E'\n  if p_day_of_week not between 1 and 5 then';
  v_new := 'begin' || E'\n  if nullif(trim(coalesce(p_customer_name, '''')), '''') is null then' || E'\n    raise exception ''Customer name is required'';' || E'\n  end if;' || E'\n  if p_people is null or p_people < 1 then' || E'\n    raise exception ''People must be at least 1'';' || E'\n  end if;' || E'\n  if p_day_of_week not between 1 and 5 then';
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected school-swimming validation insertion point was not found; no school booking function changed';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := 'greatest(1,p_people)';
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected school-swimming people coercion was not found; no school booking function changed';
  END IF;
  v_def := replace(v_def, v_old, 'p_people');
  EXECUTE v_def;
END
$migration$;
