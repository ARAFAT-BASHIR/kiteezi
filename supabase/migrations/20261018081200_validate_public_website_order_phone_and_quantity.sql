CREATE OR REPLACE FUNCTION public.place_website_order(
  p_customer_name text,
  p_phone text,
  p_email text DEFAULT NULL::text,
  p_fulfillment_method text DEFAULT 'pickup'::text,
  p_delivery_address text DEFAULT NULL::text,
  p_customer_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(order_id uuid, order_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_customer_id uuid;
  v_order_id uuid;
  v_phone text := private.normalize_phone(p_phone);
  v_total numeric := 0;
  v_item jsonb;
  v_menu_item public.menu_items%rowtype;
  v_qty numeric;
BEGIN
  IF nullif(trim(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  IF nullif(v_phone, '') IS NULL THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  IF lower(coalesce(p_fulfillment_method, 'pickup')) NOT IN ('pickup', 'delivery', 'dine_in') THEN
    RAISE EXCEPTION 'Fulfillment method must be pickup, delivery, or dine in';
  END IF;

  IF lower(coalesce(p_fulfillment_method, 'pickup')) = 'delivery'
     AND nullif(trim(coalesce(p_delivery_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Delivery address is required for delivery orders';
  END IF;

  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one menu item is required';
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.phone = v_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers(name, phone, email)
    VALUES (trim(p_customer_name), v_phone, nullif(trim(coalesce(p_email, '')), ''))
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = trim(p_customer_name),
        email = coalesce(nullif(trim(coalesce(p_email, '')), ''), email)
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO public.orders(
    customer_id, source, status, payment_status, total,
    fulfillment_method, delivery_address, customer_notes
  )
  VALUES (
    v_customer_id, 'website', 'pending', 'unpaid', 0,
    lower(coalesce(p_fulfillment_method, 'pickup')),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    nullif(trim(coalesce(p_customer_notes, '')), '')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF nullif(v_item->>'menu_item_id', '') IS NULL THEN
      RAISE EXCEPTION 'Each order item requires a menu_item_id';
    END IF;

    v_qty := coalesce((v_item->>'qty')::numeric, 1);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Order item quantity must be greater than zero';
    END IF;

    SELECT * INTO v_menu_item
    FROM public.menu_items mi
    WHERE mi.id = (v_item->>'menu_item_id')::uuid
      AND mi.in_stock = true
      AND coalesce(mi.price_on_request, false) = false
      AND coalesce(mi.price, 0) > 0;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One of the selected menu items is unavailable or is priced on request';
    END IF;

    INSERT INTO public.order_items(order_id, menu_item_id, qty, unit_price, notes)
    VALUES (
      v_order_id, v_menu_item.id, v_qty, v_menu_item.price,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    );

    v_total := v_total + (v_menu_item.price * v_qty);
  END LOOP;

  UPDATE public.orders SET total = v_total WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$function$;
