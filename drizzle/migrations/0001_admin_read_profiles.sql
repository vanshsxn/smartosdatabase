CREATE POLICY profiles_admin_read ON public.profiles FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY job_progress_admin_read ON public.job_progress FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY alert_events_admin_read ON public.alert_events FOR SELECT TO authenticated USING (public.is_admin());