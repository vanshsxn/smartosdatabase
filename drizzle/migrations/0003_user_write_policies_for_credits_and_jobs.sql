create policy tenant_credits_insert on public.tenant_credits for insert with check (is_admin() or tenant_id = (select p.tenant_id from public.profiles p where p.id = auth.uid()));
create policy tenant_credits_update on public.tenant_credits for update using (is_admin() or tenant_id = (select p.tenant_id from public.profiles p where p.id = auth.uid()));
create policy job_requests_insert on public.job_requests for insert with check (auth.uid() = user_id);
create policy job_requests_update on public.job_requests for update using (auth.uid() = user_id or is_admin());