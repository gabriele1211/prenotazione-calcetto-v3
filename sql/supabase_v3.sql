-- PRENOTAZIONE CALCETTO V3
-- Eseguire una sola volta nel SQL Editor di Supabase.

alter table public.prenotazioni
  add column if not exists documento_numero text,
  add column if not exists documento_data_rilascio date,
  add column if not exists documento_rilasciato_da text;

create index if not exists idx_prenotazioni_documento_data
  on public.prenotazioni (documento_numero, data)
  where stato = 'confermata';

create table if not exists public.impostazioni_prenotazioni (
  id smallint primary key default 1 check (id = 1),
  prenotazioni_attive boolean not null default true,
  chiusura_dal date,
  chiusura_al date,
  messaggio_chiusura text,
  aggiornato_il timestamptz not null default now()
);

insert into public.impostazioni_prenotazioni (id, prenotazioni_attive)
values (1, true)
on conflict (id) do nothing;

alter table public.impostazioni_prenotazioni enable row level security;

drop policy if exists "lettura pubblica impostazioni" on public.impostazioni_prenotazioni;
create policy "lettura pubblica impostazioni"
on public.impostazioni_prenotazioni for select
to anon, authenticated
using (true);

drop policy if exists "gestore modifica impostazioni" on public.impostazioni_prenotazioni;
create policy "gestore modifica impostazioni"
on public.impostazioni_prenotazioni for update
to authenticated
using (true)
with check (true);

grant select on public.impostazioni_prenotazioni to anon, authenticated;
grant update on public.impostazioni_prenotazioni to authenticated;

-- Funzione atomica: controlla chiusura, limite settimanale e inserisce.
-- Il tipo di p_campo_id deve coincidere con prenotazioni.campo_id.
-- Nel progetto attuale è normalmente UUID. Se Supabase segnala incompatibilità,
-- sostituire uuid con il tipo effettivo della colonna campo_id.
create or replace function public.crea_prenotazione_v3(
  p_campo_id uuid,
  p_nome_cliente text,
  p_telefono text,
  p_documento_numero text,
  p_documento_data_rilascio date,
  p_documento_rilasciato_da text,
  p_data date,
  p_ora_inizio time,
  p_ora_fine time,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_doc text := upper(regexp_replace(coalesce(p_documento_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_settimana_inizio date := date_trunc('week', p_data::timestamp)::date;
  v_settimana_fine date := (date_trunc('week', p_data::timestamp) + interval '7 days')::date;
  v_count integer;
  v_settings public.impostazioni_prenotazioni%rowtype;
begin
  select * into v_settings from public.impostazioni_prenotazioni where id = 1;
  if not coalesce(v_settings.prenotazioni_attive, true)
     or (v_settings.chiusura_dal is not null and v_settings.chiusura_al is not null
         and p_data between v_settings.chiusura_dal and v_settings.chiusura_al) then
    raise exception 'PRENOTAZIONI_SOSPESE';
  end if;

  if p_ora_inizio < time '09:00' or p_ora_fine > time '22:00' or p_ora_fine - p_ora_inizio <> interval '1 hour' then
    raise exception 'ORARIO_NON_VALIDO';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_doc || v_settimana_inizio::text));
  select count(*) into v_count
  from public.prenotazioni
  where upper(regexp_replace(coalesce(documento_numero, ''), '[^A-Za-z0-9]', '', 'g')) = v_doc
    and data >= v_settimana_inizio and data < v_settimana_fine
    and stato = 'confermata';

  if v_count >= 2 then raise exception 'LIMITE_SETTIMANALE'; end if;

  insert into public.prenotazioni (
    campo_id,nome_cliente,telefono,documento_numero,documento_data_rilascio,
    documento_rilasciato_da,data,ora_inizio,ora_fine,note,stato
  ) values (
    p_campo_id,trim(p_nome_cliente),trim(p_telefono),v_doc,p_documento_data_rilascio,
    trim(p_documento_rilasciato_da),p_data,p_ora_inizio,p_ora_fine,nullif(trim(p_note),''),'confermata'
  ) returning id into v_id;
  return v_id;
exception
  when unique_violation then raise exception 'ORARIO_OCCUPATO';
end;
$$;

grant execute on function public.crea_prenotazione_v3(uuid,text,text,text,date,text,date,time,time,text) to anon, authenticated;

-- L'area gestore deve poter leggere e aggiornare le prenotazioni.
grant select, update on public.prenotazioni to authenticated;

-- V3.2.6: cancellazione automatica delle prenotazioni trascorsi 30 giorni dalla data di utilizzo.
create extension if not exists pg_cron with schema extensions;

create or replace function public.elimina_prenotazioni_scadute_30_giorni()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eliminate integer;
begin
  delete from public.prenotazioni where data < (current_date - 30);
  get diagnostics v_eliminate = row_count;
  return v_eliminate;
end;
$$;

revoke all on function public.elimina_prenotazioni_scadute_30_giorni() from public;
grant execute on function public.elimina_prenotazioni_scadute_30_giorni() to postgres, service_role;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'elimina-prenotazioni-dopo-30-giorni' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end $$;

select cron.schedule(
  'elimina-prenotazioni-dopo-30-giorni',
  '15 3 * * *',
  $$select public.elimina_prenotazioni_scadute_30_giorni();$$
);
