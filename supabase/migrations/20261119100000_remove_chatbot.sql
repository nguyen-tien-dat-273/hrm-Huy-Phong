-- Gỡ hẳn trợ lý hỏi đáp: bảng nhật ký, kho quy chế và mọi hàm chatbot_*.
drop table if exists public.chatbot_logs cascade;
drop table if exists public.chatbot_knowledge cascade;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'chatbot\_%'
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;
