revoke execute on function public.log_ocr_event(uuid, text, jsonb) from public, anon;
revoke execute on function public.log_ocr_failure(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.process_receipt_ocr(jsonb) from public, anon;