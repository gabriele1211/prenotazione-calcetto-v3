-- PRENOTAZIONE CALCETTO V3.3
-- Cancellazione manuale riservata al gestore autenticato.
-- Eseguire UNA SOLA VOLTA nel Supabase SQL Editor.

create or replace function public.elimina_prenotazione_gestore(
  p_prenotazione_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eliminate integer;
begin
  if auth.uid() is null then
    raise exception 'ACCESSO_NON_AUTORIZZATO';
  end if;

  delete from public.prenotazioni
  where id = p_prenotazione_id;

  get diagnostics v_eliminate = row_count;
  return v_eliminate = 1;
end;
$$;

revoke all on function public.elimina_prenotazione_gestore(uuid) from public;
revoke all on function public.elimina_prenotazione_gestore(uuid) from anon;
grant execute on function public.elimina_prenotazione_gestore(uuid) to authenticated;
