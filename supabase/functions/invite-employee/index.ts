import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_URL = 'https://grove89.github.io/staff-schedule-hub/';
const allowedOrigin = new URL(SITE_URL).origin;
const corsFor = (req: Request) => {
  const requestedHeaders = req.headers.get('Access-Control-Request-Headers');
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  };
};
const reply = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return reply(req, { error: 'Server configuration missing' }, 500);

    const bearer = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(bearer)) return reply(req, { error: 'Sign in required' }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: bearer } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: identityError } = await userClient.auth.getUser();
    if (identityError || !identity.user) return reply(req, { error: 'Invalid login' }, 401);

    const body = await req.json().catch(() => null);
    const employeeId = body?.employee_id;
    if (!Number.isSafeInteger(employeeId) || employeeId < 1) {
      return reply(req, { error: 'A valid employee_id is required' }, 400);
    }

    // Check permissions using the signed-in manager's account.
    const { data: employee, error: employeeError } = await userClient
      .from('Employees')
      .select('id, home_id, auth_user_id, user_id')
      .eq('id', employeeId)
      .maybeSingle();
    if (employeeError || !employee) return reply(req, { error: 'Employee not found or not accessible' }, 404);

    const { data: permitted, error: permissionError } = await userClient.rpc('can_manage_home', {
      target_home_id: employee.home_id,
    });
    if (permissionError || permitted !== true) return reply(req, { error: 'Management permission required' }, 403);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: latest, error: latestError } = await admin
      .from('Employees')
      .select('auth_user_id, user_id, email')
      .eq('id', employeeId)
      .single();
    if (latestError || !latest) return reply(req, { error: 'Employee unavailable' }, 404);

    if (!latest.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(latest.email.trim())) {
      return reply(req, { error: 'Save a valid employee email first' }, 400);
    }

    // Existing linked employees receive a recovery email; never create a duplicate auth account.
    if (latest.auth_user_id || latest.user_id) {
      const { error: recoveryError } = await userClient.auth.resetPasswordForEmail(latest.email.trim(), { redirectTo: SITE_URL });
      if (recoveryError) return reply(req, { error: 'Password email could not be sent: ' + recoveryError.message }, 400);
      return reply(req, { success: true, message: 'Password reset requested for existing employee' });
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      latest.email.trim(),
      { redirectTo: SITE_URL },
    );
    if (inviteError || !invited.user?.id) {
      return reply(req, { error: inviteError?.message || 'Invitation could not be created' }, 400);
    }

    const { data: linked, error: linkError } = await admin
      .from('Employees')
      .update({ auth_user_id: invited.user.id, user_id: invited.user.id })
      .eq('id', employeeId)
      .is('auth_user_id', null)
      .is('user_id', null)
      .select('id');
    if (linkError || !linked || linked.length !== 1) {
      console.error('Invitation created but employee link failed', employeeId, linkError);
      return reply(req, {
        error: 'Invitation may have been sent, but account linking failed. Do not resend; contact the administrator.',
      }, 500);
    }

    return reply(req, { success: true, message: 'Invitation requested and account linked' });
  } catch (error) {
    console.error('invite-employee failed', error);
    return reply(req, { error: 'Unexpected server error' }, 500);
  }
});
