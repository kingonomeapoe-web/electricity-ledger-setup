REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_property_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_property_resident(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_central_meter_credit(uuid,numeric,numeric,numeric,uuid,uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.post_confirmed_submeter_consumption(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;