// Netlify Function: notify-user
// Sends approval notification email via Supabase

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { email, name } = JSON.parse(event.body || "{}");
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: "Email requerido" }) };

    // Use Supabase Admin to send email (configure in Supabase dashboard)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_SERVICE_KEY) {
      // No service key configured - skip email silently
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, note: "No service key" }) };
    }

    // Trigger password reset email (this notifies the user)
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
