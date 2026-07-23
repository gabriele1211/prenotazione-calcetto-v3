-- V3.2.6 - CANCELLAZIONE AUTOMATICA DATI DOPO 30 GIORNI
-- Eseguire UNA SOLA VOLTA nel SQL Editor di Supabase.
-- Cancella l'intera prenotazione 30 giorni dopo la data di utilizzo del campo.

create extension if not exists pg_cron with schema extensions;

-- Funzione richiamabile anche manualmente per prova o manutenzione.
create or replace function public.elimina_prenotazioni_scadute_30_giorni()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eliminate integer;
begin
  delete from public.prenotazioni
  where data < (current_date - 30);

  get diagnostics v_eliminate = row_count;
  return v_eliminate;
end;
$$;

revoke all on function public.elimina_prenotazioni_scadute_30_giorni() from public;
grant execute on function public.elimina_prenotazioni_scadute_30_giorni() to postgres, service_role;

-- Rimuove un eventuale job precedente con lo stesso nome, così lo script è rieseguibile.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'elimina-prenotazioni-dopo-30-giorni'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end $$;

-- Esecuzione ogni notte alle 03:15 UTC.
select cron.schedule(
  'elimina-prenotazioni-dopo-30-giorni',
  '15 3 * * *',
  $$select public.elimina_prenotazioni_scadute_30_giorni();$$
);

-- Verifica finale: deve comparire una riga con active = true.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'elimina-prenotazioni-dopo-30-giorni';
